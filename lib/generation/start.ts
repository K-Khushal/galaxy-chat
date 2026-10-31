import "server-only";
import { convertToModelMessages, type UIMessage } from "ai";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/lib/api/context";
import { loadByokKey } from "@/lib/byok/store";
import {
  type ChatRow,
  finishReply,
  listMessages,
  type MessageParts,
  type MessageRow,
} from "@/lib/chat/store";
import { pathTo } from "@/lib/chat/tree";
import { chat, message } from "@/lib/db/schema";
import { AppError, logErrorId } from "@/lib/errors";
import { acquireGeneration, releaseGeneration } from "@/lib/generation/locks";
import { refundPayment, takePayment } from "@/lib/generation/payment";
import { runGeneration } from "@/lib/generation/run";
import { resolveModel } from "@/lib/models";

export type TextPart = { type: "text"; text: string };

/** What a client asks for. Edits are submits under the edited Message's parent. */
export type StartRequest =
  | {
      trigger: "submit-message";
      /** The Reply this Message answers; null for a first Message. */
      parentId: string | null;
      /** Optional client-chosen ID for the new User Message. */
      messageId?: string;
      parts: TextPart[];
      model?: string;
    }
  | {
      /** A new Version of an existing Reply. */
      trigger: "regenerate-message";
      messageId: string;
      model?: string;
    }
  | {
      /** Carries on an Interrupted Reply, in place. */
      trigger: "continue-message";
      messageId: string;
    };

type Plan = {
  /** The User Message to insert, for a submit. */
  userMessage: {
    id: string;
    parentId: string | null;
    parts: TextPart[];
  } | null;
  /** Messages the model sees, oldest first. */
  history: { role: "user" | "assistant"; parts: MessageParts }[];
  replyId: string;
  replyParentId: string;
  /** Set when continuing an existing Reply. */
  continuing: MessageRow | null;
  modelId: string;
};

function plan(
  chatRow: ChatRow,
  messages: MessageRow[],
  request: StartRequest,
): Plan {
  const byId = new Map(messages.map((row) => [row.id, row]));
  const asHistory = (rows: MessageRow[]) =>
    rows.map((row) => ({ role: row.role, parts: row.parts as MessageParts }));

  if (request.trigger === "submit-message") {
    const parent = request.parentId ? byId.get(request.parentId) : null;
    if (parent === undefined) throw new AppError("message_not_found", 404);
    if (parent && parent.role !== "assistant") {
      throw new AppError("invalid_parent", 400);
    }
    const id = request.messageId ?? crypto.randomUUID();
    if (byId.has(id)) throw new AppError("message_exists", 409);
    return {
      userMessage: { id, parentId: request.parentId, parts: request.parts },
      history: [
        ...asHistory(pathTo(messages, request.parentId)),
        { role: "user", parts: request.parts },
      ],
      replyId: crypto.randomUUID(),
      replyParentId: id,
      continuing: null,
      modelId: request.model ?? chatRow.model,
    };
  }

  const target = byId.get(request.messageId);
  if (!target) throw new AppError("message_not_found", 404);
  if (target.role !== "assistant" || !target.parentId) {
    throw new AppError("not_a_reply", 400);
  }
  if (request.trigger === "regenerate-message") {
    return {
      userMessage: null,
      history: asHistory(pathTo(messages, target.parentId)),
      replyId: crypto.randomUUID(),
      replyParentId: target.parentId,
      continuing: null,
      modelId: request.model ?? chatRow.model,
    };
  }
  if (target.status !== "interrupted") {
    throw new AppError("not_continuable", 409);
  }
  return {
    userMessage: null,
    history: asHistory(pathTo(messages, target.id)),
    replyId: target.id,
    replyParentId: target.parentId,
    continuing: target,
    modelId: target.model ?? chatRow.model,
  };
}

function firstUserText(history: Plan["history"]): string {
  const first = history.find((entry) => entry.role === "user");
  return (first?.parts ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

/**
 * Starts a Generation in a Chat the caller owns: takes the locks, charges
 * payment, stores the Messages and starts the model. Every failure before the
 * model starts undoes the charge and the locks.
 */
export async function startGeneration(
  ctx: AppContext,
  userId: string,
  chatRow: ChatRow,
  request: StartRequest,
): Promise<{ messageId: string; stream: ReadableStream<string> }> {
  const messages = await listMessages(ctx.db, chatRow.id);
  const steps = plan(chatRow, messages, request);
  const model = resolveModel(steps.modelId);
  if (!model) throw new AppError("unknown_model", 400);
  const modelMessages = await convertToModelMessages(
    steps.history
      .filter((entry) =>
        entry.parts.some((part) => part.type !== "text" || part.text !== ""),
      )
      .map((entry) => ({ role: entry.role, parts: entry.parts }) as UIMessage),
  );

  const generationId = crypto.randomUUID();
  const acquired = await acquireGeneration(
    ctx.kv,
    {
      chatId: chatRow.id,
      userId,
      active: { generationId, messageId: steps.replyId },
    },
    ctx.timing.lockTtlMs,
  );
  if (!acquired.ok) {
    throw new AppError(
      acquired.error,
      acquired.error === "generation_in_progress" ? 409 : 429,
    );
  }
  const { lease } = acquired;

  let payment: Awaited<ReturnType<typeof takePayment>>;
  try {
    payment = await takePayment(
      {
        db: ctx.db,
        platformKey: ctx.platformKey,
        loadByokKey: (id) => loadByokKey(ctx.db, ctx.byokEnv, id),
      },
      userId,
      model,
    );
  } catch (error) {
    await releaseGeneration(ctx.kv, lease);
    throw error;
  }

  const undo = async () => {
    await refundPayment(ctx.db, userId, payment).catch(() =>
      logErrorId("credit_refund_failed"),
    );
    await releaseGeneration(ctx.kv, lease).catch(() =>
      logErrorId("lock_release_failed"),
    );
  };

  try {
    await ctx.db.transaction(async (tx) => {
      if (steps.userMessage) {
        await tx.insert(message).values({
          ...steps.userMessage,
          chatId: chatRow.id,
          role: "user",
          status: "complete",
        });
      }
      const reply = {
        model: model.id,
        payment: payment.source,
        status: "interrupted" as const,
        error: null,
      };
      if (steps.continuing) {
        await tx
          .update(message)
          .set(reply)
          .where(eq(message.id, steps.replyId));
      } else {
        await tx.insert(message).values({
          ...reply,
          id: steps.replyId,
          chatId: chatRow.id,
          parentId: steps.replyParentId,
          role: "assistant",
          parts: [],
        });
      }
      await tx
        .update(chat)
        .set({
          activeLeafMessageId: steps.replyId,
          model:
            request.trigger === "continue-message" ? chatRow.model : model.id,
          updatedAt: new Date(),
        })
        .where(eq(chat.id, chatRow.id));
    });
  } catch (error) {
    await undo();
    if (
      error instanceof Error &&
      /duplicate key|unique/i.test(`${error.message} ${error.cause ?? ""}`)
    ) {
      throw new AppError("message_exists", 409);
    }
    throw error;
  }

  try {
    const stream = await runGeneration(ctx, {
      chatId: chatRow.id,
      userId,
      generationId,
      replyId: steps.replyId,
      model,
      payment,
      lease,
      messages: modelMessages,
      initialParts: (steps.continuing?.parts as MessageParts) ?? [],
      titleFrom: chatRow.title === null ? firstUserText(steps.history) : null,
    });
    return { messageId: steps.replyId, stream };
  } catch {
    logErrorId("generation_start_failed");
    if (!steps.continuing) {
      await finishReply(ctx.db, steps.replyId, {
        parts: [],
        status: "failed",
        usage: null,
        error: "generation_unavailable",
      }).catch(() => logErrorId("reply_save_failed"));
    }
    await undo();
    throw new AppError("generation_unavailable", 503);
  }
}
