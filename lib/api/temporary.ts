import "server-only";
import { JsonToSseTransformStream, streamText, type UIMessageChunk } from "ai";
import { z } from "zod";
import { customContext } from "@/lib/account/settings";
import type { AppContext } from "@/lib/api/context";
import { handle, readJson, sseResponse } from "@/lib/api/respond";
import { refundCredit } from "@/lib/credits";
import { AppError } from "@/lib/errors";
import {
  acquireGeneration,
  lockError,
  releaseGeneration,
  renewGeneration,
} from "@/lib/generation/locks";
import { errorId, replyModelSettings } from "@/lib/generation/model";
import { payForReply, spendForReply } from "@/lib/generation/payment";
import { resolveModel } from "@/lib/models";

/** Text-only client history: no system prompts, tools, attachments or saved IDs. */
const historySchema = z.strictObject({
  model: z
    .string()
    .max(100)
    .refine((id) => resolveModel(id) !== null),
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(100_000),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (messages) =>
        messages.every(
          (message, index) =>
            message.role === (index % 2 === 0 ? "user" : "assistant") &&
            (message.role !== "user" || message.content.length > 0),
        ) && messages.at(-1)?.role === "user",
    ),
});

/** POST /api/temporary/messages. Only Credits may be written to Postgres. */
export function temporaryMessageRoute(ctx: AppContext, request: Request) {
  return handle(async () => {
    const userId = await ctx.authenticate(request);
    const body = await readJson(request, historySchema, 1024 * 1024);
    if (!(await ctx.rateLimit("send", userId)))
      throw new AppError("rate_limited", 429);
    const model = resolveModel(body.model);
    if (!model) throw new AppError("invalid_request", 400);
    const generationId = crypto.randomUUID();
    // A unique, Redis-only Chat lock lets Temporary chats share the expiring
    // per-User slots with saved Chats without creating any Postgres row.
    const acquired = await acquireGeneration(
      ctx.kv,
      {
        chatId: `temporary:${generationId}`,
        userId,
        active: { generationId, messageId: generationId },
      },
      ctx.timing.lockTtlMs,
    );
    if (!acquired.ok) throw lockError(acquired.error);

    const abort = new AbortController();
    let firstToken = false;
    let complete = false;
    let stopped = false;
    let charged = false;
    let cleanup: Promise<void> | undefined;
    let renewal: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const stop = () => abort.abort();
    const clientStop = () => {
      stopped = true;
      stop();
    };
    const finish = () => {
      cleanup ??= (async () => {
        clearInterval(renewal);
        clearTimeout(deadline);
        request.signal.removeEventListener("abort", clientStop);
        try {
          if (charged && !firstToken && !complete && !stopped)
            await refundCredit(ctx.db, userId);
        } finally {
          await releaseGeneration(ctx.kv, acquired.lease);
        }
      })();
      return cleanup;
    };

    try {
      // Nothing is stored: the debit alone records a Temporary chat's payment.
      const { payment } = await payForReply(ctx, userId, model, (payment) =>
        spendForReply(ctx.db, userId, payment),
      );
      charged = payment.source === "credits";
      request.signal.addEventListener("abort", clientStop, { once: true });
      if (request.signal.aborted) clientStop();
      renewal = setInterval(() => {
        renewGeneration(ctx.kv, acquired.lease, ctx.timing.lockTtlMs)
          .then((held) => {
            if (!held) stop();
          })
          .catch(stop);
      }, ctx.timing.renewMs);
      deadline = setTimeout(stop, ctx.timing.deadlineMs);
      const system = await customContext(ctx.db, userId);
      const source = streamText({
        ...replyModelSettings(ctx, model, payment),
        system,
        messages: body.messages,
        abortSignal: abort.signal,
        onError: () => {},
      }).toUIMessageStream({
        generateMessageId: () => generationId,
        sendReasoning: true,
        onError: errorId,
      });
      let cancelled = false;
      const stream = new ReadableStream<UIMessageChunk>({
        async start(controller) {
          try {
            for await (const chunk of source) {
              if (
                (chunk.type === "text-delta" ||
                  chunk.type === "reasoning-delta") &&
                chunk.delta.length
              )
                firstToken = true;
              if (chunk.type === "finish" && chunk.finishReason !== "error")
                complete = true;
              if (!cancelled) controller.enqueue(chunk);
            }
          } catch {
            if (!cancelled)
              controller.enqueue({
                type: "error",
                errorText: "generation_failed",
              });
          } finally {
            await finish();
            if (!cancelled) controller.close();
          }
        },
        async cancel() {
          cancelled = true;
          clientStop();
          await finish();
        },
      });
      return sseResponse(stream.pipeThrough(new JsonToSseTransformStream()));
    } catch (error) {
      stop();
      await finish();
      throw error;
    }
  });
}
