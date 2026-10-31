# Resumable Generations

Verified 2026-10-31 after `bun install` on the pre-M0 repository: `ai@7.0.143`, `@ai-sdk/react@4.0.147`, `next@16.4.2`, `@openrouter/ai-sdk-provider@3.1.0`. Missing dependencies were installed only in an isolated scratch project: `resumable-stream@2.2.13`, `redis@6.3.1`. M0 subsequently removed the AI SDK dependencies; M3 must explicitly reinstall these verified versions (or reverify newer versions). Next remains 16.4.2 after rebase. No application dependencies changed in this PR. Snippets below match installed exports/signatures; database operations and lifecycle orchestration remain application work, not tested production code.

## ADR 0004 discrepancy — resolve before implementation

`resumable-stream/dist/runtime.js:createNewResumableStream` stores chunks in a local `const chunks = []`. Redis holds a 24-hour sentinel and pub/sub messages; replay asks the **living producer** for its in-memory chunks. Redis does not hold a durable output log. A dead producer cannot replay, and a finished Generation must be read from Postgres. This contradicts ADR 0004's statement that output chunks go to Redis through this package. Do not silently claim durable Redis buffering: obtain an ADR clarification, or explicitly design additional persisted chunks. Checkpoints provide partial recovery, not continuation of the original provider request after process death. No durable jobs are proposed.

Source: [package README and source](https://github.com/vercel/resumable-stream), verified in installed `dist/runtime.js` and `dist/types.d.ts`.

## Redis and stream wiring

Use Node runtime and the Upstash **TCP TLS** URL (`rediss://default:password@host:6379`), not its REST URL/token. Default import uses node-redis (`redis`); `/ioredis` is a separate adapter. `@upstash/redis` REST client is suitable for counters/cache but is not a drop-in pub/sub client. Use separate publisher and subscriber connections. The package connects only its default clients; explicitly connect supplied publisher/subscriber clients before using the context. Add Redis error listeners and reuse a lazily initialized context; do not open connections per chunk.

```ts
import 'server-only';
import { after } from 'next/server';
import { createClient } from 'redis';
import { createResumableStreamContext } from 'resumable-stream';

export async function makeContext(redisUrl: string) {
  const publisher = createClient({ url: redisUrl });
  const subscriber = publisher.duplicate();
  // Register error listeners here; report sanitized errors, never URLs.
  await Promise.all([publisher.connect(), subscriber.connect()]);
  return createResumableStreamContext({
    publisher, subscriber,
    waitUntil: (promise) => after(() => promise),
    keyPrefix: 'galaxy:generation',
  });
}
```

`createNewResumableStream(id, () => stringStream)` starts; `resumeExistingStream(id, skipCharacters?)` returns a string stream, `null` for done or `undefined` for missing. An offset counts JavaScript string characters, not tokens or bytes. Omit it for full replay. Never use `resumableStream` on reconnect with a factory that could launch a second model request.

A minimal server response adapter (call within the Route Handler):

```ts
import { consumeStream, createUIMessageStream,
  createUIMessageStreamResponse, streamText } from 'ai';
import { after } from 'next/server';

// result = streamText({ model, messages, abortSignal: controller.signal });
// context and generationId are authenticated, server-owned values.
function respond(
  result: ReturnType<typeof streamText>,
  context: Awaited<ReturnType<typeof makeContext>>,
  generationId: string,
) {
  const stream = createUIMessageStream({
    execute: ({ writer }) => { writer.merge(result.toUIMessageStream()); },
  });
  return createUIMessageStreamResponse({
    stream,
    consumeSseStream: ({ stream: sse }) => {
      // Register immediately: the SDK does not await this callback.
      after(async () => {
        const replay = await context.createNewResumableStream(
          generationId, () => sse,
        );
        if (replay) await consumeStream({ stream: replay });
      });
    },
  });
}
```

Alternatively `result.toUIMessageStreamResponse({ consumeSseStream })` performs the wrapper step directly. The option is **consumeSseStream**, not `consumeStream`; `consumeStream({ stream })` is the draining utility. `after(() => result.consumeStream())` is another way to drain the model result but does not alone register replay. Do not attach `request.signal` to the provider: closing a tab must not Stop a Generation. Ensure the POST does not expose success before replay registration is ready (use a readiness protocol/retry for a racing GET).

Sources: installed `ai/src/ui-message-stream/create-ui-message-stream-response.ts`, `create-ui-message-stream.ts`, `ai/src/generate-text/stream-text.ts`; [AI SDK persistence/resumption](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams).

## Reconnect and Stop

```tsx
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

const chat = useChat({
  id: chatId,
  messages: persistedMessages,
  resume: true,
  transport: new DefaultChatTransport({
    api: `/api/chats/${encodeURIComponent(chatId)}/messages`,
    prepareReconnectToStreamRequest: ({ id }) => ({
      api: `/api/chats/${encodeURIComponent(id)}/stream`,
    }),
  }),
});
```

Memoize transport/options in the application. `resume: true` attempts resumption on mount; `resumeStream()` is also exposed. The reconnect callback returns `api`, `headers`, `credentials`; no request body is sent by this GET. Owner-check GET, look up the Chat's active Generation and call `resumeExistingStream`. Return 204 if nothing is resumable; otherwise return encoded SSE with `UI_MESSAGE_STREAM_HEADERS` from `ai`. Rehydrate complete Replies from Postgres. Use stable assistant Message IDs; do not append full replay to a checkpoint's partial text or it duplicates output. Test reconnect during partial output and after completion.

Sources: installed `@ai-sdk/react/src/use-chat.ts`, `ai/src/ui/http-chat-transport.ts`, `ai/src/ui/default-chat-transport.ts`.

`chat.stop()` only aborts the client's transport. Implement Stop as an authenticated POST writing a TTL-backed `stop:<generationId>` Redis key and optionally publishing a notification. The producer polls the durable flag (e.g. every 250–500ms) or subscribes with polling fallback, then calls its own `AbortController.abort()`. Polling closes the pub/sub lost-signal race. Persist Stopped with partial parts; do not infer Stop merely from a provider abort. Clear polling/listeners in `finally`; authorize ownership and Generation ID on every operation.

## Checkpoints, locks and time limits

Accumulate text/reasoning parts from `streamText` callbacks (`onChunk`, `onFinish`, `onAbort`) or consume a tee of the UI stream with `readUIMessageStream`; do not drain the same stream twice. Snapshot parts every ~2s, serialize database writes, flush on finish/Stop/error, and prevent an old checkpoint overwriting final status. Store one Reply with stable ID. On hard process termination no callback is guaranteed: stale active metadata plus expired Redis lock must reconcile to Interrupted using the last checkpoint. A timer several seconds before the platform deadline allows a best-effort final flush.

Acquire expiring per-Chat locks and per-user capacity atomically; use Generation ownership tokens for renew/release and compare-and-delete, not unconditional DEL. Publish active Generation only after ownership/payment setup; compensate setup failures. Expiry must release a crashed Generation, with no Postgres pending row blocking the Chat. Temporary chats bypass replay and persistence.

Installed Next guide: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`: `after` accepts a callback and shares the route's platform duration, including background work. It is not a fresh time allowance or a durable worker. Use `export const runtime = 'nodejs'` and an explicit literal `export const maxDuration = 300` for Hobby; Pro can use 800 seconds under generally available Fluid limits. Fluid defaults are 300 seconds on both. Current docs additionally advertise a Pro/Enterprise extended-duration beta to 1800 seconds on supported runtimes; do not depend on beta availability or change ADR 0004's cap implicitly. [Vercel duration source](https://vercel.com/docs/functions/configuring-functions/duration).

Pitfalls: cross-region Redis latency, subscriber connection limits, unbounded producer memory for long output, stale sentinels after crashes, replay racing startup, duplicate POST/payment, out-of-order checkpoints, secrets in Redis URLs/logs, and assuming `after` survives a deployment or function kill. Verify disconnect/reconnect and Stop on an actual Vercel deployment; local type checks cannot prove lifetime behavior.

Verification: extracted server snippets (with declared application inputs) passed TypeScript `--strict --noEmit --skipLibCheck --moduleResolution bundler --module esnext --target es2022` against the versions above. The reconnect snippet also passed; generated shadcn component composition was checked against Base UI declarations rather than compiled against a component that has not been generated yet. No external provider was called for snippet verification.
