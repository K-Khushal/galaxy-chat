import "server-only";
import { convertToModelMessages, type UIMessage } from "ai";
import { eq } from "drizzle-orm";
import { customContext } from "@/lib/account/settings";
import type { AppContext } from "@/lib/api/context";
import { resolveAttachments } from "@/lib/attachments/resolve";
import { modelSupport, supportsKind } from "@/lib/attachments/rules";
import {
  type AttachmentRow,
  claimForChat,
  filePart,
  loadForMessage,
} from "@/lib/attachments/store";
import { loadByokKey } from "@/lib/byok/store";
import {
  type ChatRow,
  finishReply,
  listMessages,
  type MessageParts,
  type MessageRow,
} from "@/lib/chat/store";
import { pathTo } from "@/lib/chat/tree";
import { chat, message, user } from "@/lib/db/schema";
import { AppError, logErrorId } from "@/lib/errors";
import {
  acquireGeneration,
  isStopRequested,
  releaseGeneration,
} from "@/lib/generation/locks";
import {
  choosePayment,
  type Payment,
  refundReplyCredit,
  spendForReply,
} from "@/lib/generation/payment";
import { recoverRepliesQuietly } from "@/lib/generation/recover";
import { runGeneration } from "@/lib/generation/run";
import { type ResolvedModel, resolveModel } from "@/lib/models";

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
      /** Ready Attachments sent with the text; at most five. */
      attachmentIds?: string[];
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
    parts: MessageParts;
    /** Attachments the Message uses; tied to the Chat when it is stored. */
    attachmentIds: string[];
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
  files: AttachmentRow[],
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
    if (request.parts.length + files.length === 0) {
      throw new AppError("invalid_request", 400);
    }
    // Files first, then the question, which is how models read them best.
    const parts: MessageParts = [...files.map(filePart), ...request.parts];
    return {
      userMessage: {
        id,
        parentId: request.parentId,
        parts,
        attachmentIds: files.map((file) => file.id),
      },
      history: [
        ...asHistory(pathTo(messages, request.parentId)),
        { role: "user", parts },
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
    throw new AppError(
      target.status === "failed" ? "reply_recovered" : "not_continuable",
      409,
    );
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
  const text = (first?.parts ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
  if (text.trim()) return text;
  // A first Message of only files is named after them.
  return (first?.parts ?? [])
    .map((part) => (part.type === "file" ? (part.filename ?? "") : ""))
    .filter(Boolean)
    .join(", ");
}

/** The last credit went to another Generation between choosing and spending. */
class CreditsGone extends Error {}

const isDuplicate = (error: unknown) =>
  error instanceof Error &&
  /duplicate key|unique/i.test(`${error.message} ${error.cause ?? ""}`);

/**
 * Starts a Generation in a Chat the caller owns: takes the locks, then in one
 * transaction spends the credit (if Credits pay) and records the Messages, so
 * a credit is never taken without a Reply that records it. The Reply is
 * stamped with this Generation's ID; only this Generation may write it until
 * another takes it over. Any failure after that transaction refunds through
 * the same once-only path that crash recovery uses.
 */
export async function startGeneration(
  ctx: AppContext,
  userId: string,
  chatRow: ChatRow,
  request: StartRequest,
): Promise<{ messageId: string; stream: ReadableStream<string> }> {
  await recoverRepliesQuietly(ctx, userId);
  const messages = await listMessages(ctx.db, chatRow.id);
  const files =
    request.trigger === "submit-message"
      ? await loadForMessage(
          ctx.db,
          userId,
          chatRow.id,
          request.attachmentIds ?? [],
        )
      : [];
  const steps = plan(chatRow, messages, request, files);
  const model = resolveModel(steps.modelId);
  if (!model) throw new AppError("unknown_model", 400);
  const support = modelSupport(
    model.catalog?.capabilities ?? null,
    model.catalog?.label ?? model.id,
  );
  if (files.some((file) => !supportsKind(support, file.kind))) {
    throw new AppError("attachment_unsupported", 400);
  }
  // Read URLs and extracted text are made before anything is locked or
  // spent, so a storage failure costs the User nothing. A regenerated,
  // continued or resumed Reply resolves its history afresh.
  const modelHistory = await resolveAttachments(
    ctx,
    { userId, model },
    steps.history,
  );

  const generationId = crypto.randomUUID();
  const owner = { replyId: steps.replyId, generationId };
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
  const release = () =>
    releaseGeneration(ctx.kv, lease).catch(() =>
      logErrorId("lock_release_failed"),
    );

  let payment: Payment;
  let initialParts: MessageParts;
  try {
    ({ payment, initialParts } = await payAndRecord(ctx, {
      userId,
      chatRow,
      request,
      steps,
      model,
      generationId,
    }));
  } catch (error) {
    // Nothing was spent or stored: the transaction rolled back.
    await release();
    if (isDuplicate(error)) throw new AppError("message_exists", 409);
    throw error;
  }

  try {
    const history = steps.continuing
      ? [
          ...modelHistory.slice(0, -1),
          { role: "assistant" as const, parts: initialParts },
        ]
      : modelHistory;
    const modelMessages = await convertToModelMessages(
      history
        .filter((entry) =>
          entry.parts.some((part) => part.type !== "text" || part.text !== ""),
        )
        .map(
          (entry) => ({ role: entry.role, parts: entry.parts }) as UIMessage,
        ),
    );
    if (await isStopRequested(ctx.kv, generationId))
      throw new AppError("generation_stopped", 409);
    const context = await customContext(ctx.db, userId);
    const stream = await runGeneration(ctx, {
      chatId: chatRow.id,
      userId,
      generationId,
      replyId: steps.replyId,
      model,
      payment,
      lease,
      messages: modelMessages,
      system: context,
      initialParts,
      titleFrom: chatRow.title === null ? firstUserText(steps.history) : null,
    });
    return { messageId: steps.replyId, stream };
  } catch {
    logErrorId("generation_start_failed");
    await finishReply(
      ctx.db,
      owner,
      {
        parts: initialParts,
        status: steps.continuing ? "interrupted" : "failed",
        usage: null,
        error: steps.continuing ? null : "generation_unavailable",
        firstToken: false,
      },
      userId,
    ).catch(() => logErrorId("reply_save_failed"));
    await release();
    throw new AppError("generation_unavailable", 503);
  }
}

type RecordInput = {
  userId: string;
  chatRow: ChatRow;
  request: StartRequest;
  steps: Plan;
  model: ResolvedModel;
  generationId: string;
};

/**
 * Chooses who pays, then records the Reply with the payment. A second pass
 * runs only when the last credit was spent elsewhere in between: then the
 * BYOK key pays, or the User has neither.
 */
async function payAndRecord(
  ctx: AppContext,
  input: RecordInput,
): Promise<{ payment: Payment; initialParts: MessageParts }> {
  const payer = {
    db: ctx.db,
    platformKey: ctx.platformKey,
    loadByokKey: (id: string) => loadByokKey(ctx.db, ctx.byokEnv, id),
  };
  for (let attempt = 0; ; attempt++) {
    const payment = await choosePayment(payer, input.userId, input.model);
    try {
      return { payment, initialParts: await recordReply(ctx, input, payment) };
    } catch (error) {
      if (!(error instanceof CreditsGone)) throw error;
      if (attempt > 0) throw new AppError("no_credits", 402);
    }
  }
}

/**
 * The payment transaction: spends the credit, inserts or takes over the
 * Reply (stamping it with this Generation's ID and resetting its payment
 * record) and moves the active leaf. Returns the Reply's starting parts.
 */
async function recordReply(
  ctx: AppContext,
  input: RecordInput,
  payment: Payment,
): Promise<MessageParts> {
  const { steps, chatRow } = input;
  return ctx.db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update");
    if (!owner) throw new AppError("unauthenticated", 401);
    if (!(await spendForReply(tx, input.userId, payment))) {
      throw new CreditsGone();
    }
    if (steps.userMessage) {
      const { attachmentIds, ...userMessage } = steps.userMessage;
      await claimForChat(tx, input.userId, chatRow.id, attachmentIds);
      await tx.insert(message).values({
        ...userMessage,
        chatId: chatRow.id,
        role: "user",
        status: "complete",
      });
    }
    const reply = {
      model: input.model.id,
      payment: payment.source,
      generationId: input.generationId,
      firstTokenAt: null,
      creditRefunded: false,
      status: "interrupted" as const,
      error: null,
    };
    let initialParts: MessageParts = [];
    if (steps.continuing) {
      // Locked and re-read here: the previous Generation may have saved more
      // since the plan was made, and must not write once this one owns it.
      const [current] = await tx
        .select()
        .from(message)
        .where(eq(message.id, steps.replyId))
        .for("update");
      if (!current || current.status !== "interrupted") {
        throw new AppError(
          current?.status === "failed" ? "reply_recovered" : "not_continuable",
          409,
        );
      }
      // Settle the previous Generation's credit before its record is reused.
      if (current.generationId) {
        await refundReplyCredit(
          tx,
          { replyId: current.id, generationId: current.generationId },
          input.userId,
        );
      }
      initialParts = current.parts as MessageParts;
      await tx.update(message).set(reply).where(eq(message.id, steps.replyId));
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
          input.request.trigger === "continue-message"
            ? chatRow.model
            : input.model.id,
        updatedAt: new Date(),
      })
      .where(eq(chat.id, chatRow.id));
    return initialParts;
  });
}
