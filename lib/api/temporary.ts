import "server-only";
import { JsonToSseTransformStream, streamText, type UIMessageChunk } from "ai";
import { z } from "zod";
import type { AppContext } from "@/lib/api/context";
import { handle, readJson, sseResponse } from "@/lib/api/respond";
import { loadByokKey } from "@/lib/byok/store";
import { refundCredit } from "@/lib/credits";
import { AppError } from "@/lib/errors";
import {
  acquireGeneration,
  releaseGeneration,
  renewGeneration,
} from "@/lib/generation/locks";
import { errorId, replyModelSettings } from "@/lib/generation/model";
import { choosePayment, spendForReply } from "@/lib/generation/payment";
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
    // A unique, Redis-only Chat lock lets Temporary chats share M3's expiring
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
    if (!acquired.ok) throw new AppError(acquired.error, 409);

    const abort = new AbortController();
    let firstToken = false;
    let complete = false;
    let charged = false;
    let cleanup: Promise<void> | undefined;
    let renewal: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const stop = () => abort.abort();
    const finish = () => {
      cleanup ??= (async () => {
        clearInterval(renewal);
        clearTimeout(deadline);
        request.signal.removeEventListener("abort", stop);
        try {
          if (charged && !firstToken && !complete)
            await refundCredit(ctx.db, userId);
        } finally {
          await releaseGeneration(ctx.kv, acquired.lease);
        }
      })();
      return cleanup;
    };

    try {
      const payer = {
        db: ctx.db,
        platformKey: ctx.platformKey,
        loadByokKey: (id: string) => loadByokKey(ctx.db, ctx.byokEnv, id),
      };
      let payment = await choosePayment(payer, userId, model);
      // The atomic debit may lose a race for the final Credit. Re-select so a
      // saved BYOK key can pay, just as on M3's normal send path.
      if (!(await spendForReply(ctx.db, userId, payment))) {
        payment = await choosePayment(payer, userId, model);
        if (!(await spendForReply(ctx.db, userId, payment)))
          throw new AppError("no_credits", 402);
      }
      charged = payment.source === "credits";
      request.signal.addEventListener("abort", stop, { once: true });
      if (request.signal.aborted) stop();
      renewal = setInterval(() => {
        renewGeneration(ctx.kv, acquired.lease, ctx.timing.lockTtlMs)
          .then((held) => {
            if (!held) stop();
          })
          .catch(stop);
      }, ctx.timing.renewMs);
      deadline = setTimeout(stop, ctx.timing.deadlineMs);
      const source = streamText({
        ...replyModelSettings(ctx, model, payment),
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
          stop();
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
