import "server-only";
import {
  JsonToSseTransformStream,
  type ModelMessage,
  readUIMessageStream,
  streamText,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { AppContext } from "@/lib/api/context";
import {
  checkpointReply,
  finishReply,
  hasContent,
  type MessageParts,
  markFirstToken,
  type ReplyOwner,
} from "@/lib/chat/store";
import type { MessageStatus, MessageUsage } from "@/lib/db/schema";
import { logErrorId } from "@/lib/errors";
import {
  type GenerationLease,
  isStopRequested,
  releaseGeneration,
  renewGeneration,
} from "@/lib/generation/locks";
import { errorId, replyModelSettings } from "@/lib/generation/model";
import type { Payment } from "@/lib/generation/payment";
import { generateChatTitle } from "@/lib/generation/title";
import type { ResolvedModel } from "@/lib/models";

export type RunInput = {
  chatId: string;
  userId: string;
  /** Unique per Generation; also the fencing token stored on the Reply. */
  generationId: string;
  replyId: string;
  model: ResolvedModel;
  payment: Payment;
  lease: GenerationLease;
  messages: ModelMessage[];
  system?: string;
  /** Parts the Reply already has: empty, or an Interrupted Reply's text. */
  initialParts: MessageParts;
  /** The first User Message's text when the Chat still needs a title. */
  titleFrom: string | null;
};

type Observed = {
  firstToken: boolean;
  finished: boolean;
  error: string | null;
};

/**
 * Wraps the Reply's UI stream so it always ends cleanly (a provider error
 * becomes an `error` chunk) and records what happened.
 */
function observe(
  makeSource: () => ReadableStream<UIMessageChunk>,
  observed: Observed,
): ReadableStream<UIMessageChunk> {
  let reader: ReadableStreamDefaultReader<UIMessageChunk> | null = null;
  const fail = (
    controller: ReadableStreamDefaultController<UIMessageChunk>,
  ) => {
    observed.error ??= "generation_failed";
    controller.enqueue({ type: "error", errorText: observed.error });
    controller.close();
  };
  return new ReadableStream({
    start(controller) {
      try {
        reader = makeSource().getReader();
      } catch {
        fail(controller);
      }
    },
    async pull(controller) {
      if (!reader) return;
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (
          (value.type === "text-delta" || value.type === "reasoning-delta") &&
          value.delta.length > 0
        ) {
          observed.firstToken = true;
        }
        if (value.type === "error") observed.error ??= value.errorText;
        if (value.type === "finish") observed.finished = true;
        controller.enqueue(value);
      } catch {
        fail(controller);
      }
    },
  });
}

function usageFrom(event: {
  totalUsage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  providerMetadata?: Record<string, Record<string, unknown>>;
}): MessageUsage {
  const openrouter = event.providerMetadata?.openrouter?.usage as
    | { cost?: unknown }
    | undefined;
  return {
    inputTokens: event.totalUsage.inputTokens,
    outputTokens: event.totalUsage.outputTokens,
    totalTokens: event.totalUsage.totalTokens,
    ...(typeof openrouter?.cost === "number" ? { cost: openrouter.cost } : {}),
  };
}

/**
 * Starts the model request and returns the Reply's SSE stream. The request
 * runs independently of the HTTP connection: closing the tab never stops it.
 * Its output is checkpointed to Postgres, published through resumable-stream
 * for reconnecting clients, and saved in full when it ends.
 */
export async function runGeneration(
  ctx: AppContext,
  input: RunInput,
): Promise<ReadableStream<string>> {
  const { timing } = ctx;
  const controller = new AbortController();
  const observed: Observed = {
    firstToken: false,
    finished: false,
    error: null,
  };
  const owner: ReplyOwner = {
    replyId: input.replyId,
    generationId: input.generationId,
  };
  // "lost": this Generation no longer owns its locks or its Reply.
  let endReason: "stop" | "deadline" | "lost" | null = null;
  let ownershipLost = false;
  let usage: MessageUsage | null = null;
  let finished: Promise<void> | null = null;

  const end = (reason: "stop" | "deadline" | "lost") => {
    if (observed.finished) return;
    endReason ??= reason;
    controller.abort();
  };
  /** Its lock expired or a newer Generation took the Reply: stop at once. */
  const lost = () => {
    if (ownershipLost) return;
    ownershipLost = true;
    logErrorId("generation_ownership_lost");
    end("lost");
  };

  const makeSource = () =>
    streamText({
      ...replyModelSettings(ctx, input.model, input.payment),
      messages: input.messages,
      system: input.system,
      abortSignal: controller.signal,
      // Never log provider errors: they can echo request content.
      onError: () => {},
      onEnd: (event) => {
        usage = usageFrom(event);
      },
    }).toUIMessageStream({
      generateMessageId: () => input.replyId,
      sendReasoning: true,
      onError: (error) => {
        observed.error ??= errorId(error);
        return observed.error;
      },
    });

  async function persist(stream: ReadableStream<UIMessageChunk>) {
    let latest: UIMessage = {
      id: input.replyId,
      role: "assistant",
      parts: input.initialParts,
    };
    let dirty = false;
    let firstTokenSaved = false;
    let writes = Promise.resolve();
    // A fenced write that changes no row means a newer Generation owns the
    // Reply: stop the model instead of writing over it.
    const write = (task: () => Promise<boolean>) => {
      writes = writes
        .then(async () => {
          if (!ownershipLost && !(await task())) lost();
        })
        .catch(() => logErrorId("reply_save_failed"));
    };
    const timers = [
      setInterval(() => {
        if (!dirty) return;
        dirty = false;
        const parts = latest.parts;
        write(() => checkpointReply(ctx.db, owner, parts));
      }, timing.checkpointMs),
      setInterval(() => {
        isStopRequested(ctx.kv, input.generationId)
          .then((stop) => stop && end("stop"))
          .catch(() => logErrorId("stop_poll_failed"));
      }, timing.stopPollMs),
      setInterval(() => {
        renewGeneration(ctx.kv, input.lease, timing.lockTtlMs)
          .then((held) => held || lost())
          .catch(() => logErrorId("lock_renew_failed"));
      }, timing.renewMs),
    ];
    const deadline = setTimeout(() => end("deadline"), timing.deadlineMs);

    try {
      for await (const message of readUIMessageStream({
        message: latest,
        stream,
      })) {
        latest = message;
        dirty = true;
        if (observed.firstToken && !firstTokenSaved) {
          firstTokenSaved = true;
          write(() => markFirstToken(ctx.db, owner));
        }
      }
    } catch {
      observed.error ??= "generation_failed";
    } finally {
      for (const timer of timers) clearInterval(timer);
      clearTimeout(deadline);
    }
    // No checkpoint may land after the final save.
    await writes;

    let status: MessageStatus;
    let error: string | null = null;
    if (endReason === "stop") {
      status = "stopped";
    } else if (endReason === "deadline" || endReason === "lost") {
      status = "interrupted";
    } else if (observed.finished && !observed.error) {
      status = "complete";
    } else {
      error = observed.error ?? "generation_failed";
      status = hasContent(latest.parts) ? "interrupted" : "failed";
    }
    // A credit is refunded when no token arrived, unless the User stopped it.
    const refund =
      !observed.firstToken &&
      endReason !== "stop" &&
      status !== "complete" &&
      input.payment.source === "credits";

    // Fenced like every write: if a newer Generation owns the Reply, this
    // saves nothing and refunds nothing (the new owner settles the credit).
    let saved = false;
    try {
      saved = await finishReply(
        ctx.db,
        owner,
        {
          parts: latest.parts,
          status,
          usage,
          error,
          firstToken: observed.firstToken,
        },
        refund ? input.userId : null,
      );
    } catch {
      logErrorId("reply_save_failed");
    }
    // Release only after the final save, so a client that sees no running
    // Generation always reads the finished Reply from Postgres.
    await releaseGeneration(ctx.kv, input.lease).catch(() =>
      logErrorId("lock_release_failed"),
    );

    if (saved && status === "complete" && input.titleFrom !== null) {
      await generateChatTitle(ctx, {
        chatId: input.chatId,
        text: input.titleFrom,
        apiKey: input.payment.apiKey,
      });
    }
  }

  const replay = await ctx.streams.createNewResumableStream(
    input.generationId,
    () => {
      const [toPersist, toClient] = observe(makeSource, observed).tee();
      finished = persist(toPersist);
      return toClient.pipeThrough(new JsonToSseTransformStream());
    },
  );
  const running = finished as Promise<void> | null;
  if (!running || !replay) {
    // resumable-stream could not register the stream; no request was made.
    throw new Error("resumable stream was not created");
  }
  ctx.waitUntil(running);
  return replay;
}
