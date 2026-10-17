import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { requireDb } from "@/lib/db/client";
import { chat, chatBranch, chatMessage, chatRun } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import type { TypeUIMessage } from "@/lib/types";

export type BranchAction = "send" | "edit" | "regenerate" | "retry";
export type BranchInput = {
  id: string;
  requestId: string;
  branchId: string;
  action: BranchAction;
  anchorId?: string;
  message: TypeUIMessage;
  model: string;
};
export async function readBranches(
  chatId: string,
  userId: string,
  branchId?: string,
) {
  const db = requireDb();
  const owned = await db
    .select()
    .from(chat)
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)));
  if (!owned[0]) throw new AppError("not_found", 404);
  const branches = await db
    .select()
    .from(chatBranch)
    .where(and(eq(chatBranch.chatId, chatId), eq(chatBranch.userId, userId)))
    .orderBy(asc(chatBranch.createdAt), asc(chatBranch.id));
  const selected = branches.find((b) => b.id === (branchId ?? chatId));
  if (!selected) throw new AppError("not_found", 404);
  const runs = await db
    .select({
      id: chatRun.id,
      state: chatRun.state,
      branchId: chatRun.branchId,
    })
    .from(chatRun)
    .where(and(eq(chatRun.chatId, chatId), eq(chatRun.userId, userId)))
    .orderBy(asc(chatRun.createdAt), asc(chatRun.id));
  return {
    branches: branches.map((b) => ({
      id: b.id,
      label: b.label,
      parentId: b.parentId,
    })),
    branchId: selected.id,
    messages: selected.messages as TypeUIMessage[],
    runs,
  };
}
export async function prepareRun(input: BranchInput, userId: string) {
  const db = requireDb();
  return db.transaction(
    async (tx) => {
      // One transaction serializes this owner's chat creation, branch snapshot and run claim.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${input.id}))`,
      );
      const digest = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      const prior = await tx
        .select()
        .from(chatRun)
        .where(eq(chatRun.id, input.requestId));
      if (prior[0])
        throw new AppError(
          prior[0].userId === userId && prior[0].digest === digest
            ? "request_already_recorded"
            : "idempotency_conflict",
          409,
        );
      let owned = await tx.select().from(chat).where(eq(chat.id, input.id));
      if (owned[0] && owned[0].userId !== userId)
        throw new AppError("not_found", 404);
      if (!owned[0]) {
        if (input.action !== "send" || input.branchId !== input.id)
          throw new AppError("not_found", 404);
        const title =
          input.message.parts
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80) || "New conversation";
        owned = await tx
          .insert(chat)
          .values({ id: input.id, userId, title, visibility: "private" })
          .returning();
        await tx.insert(chatBranch).values({
          id: input.id,
          chatId: input.id,
          userId,
          label: "Original",
          messages: [],
        });
      }
      const source = (
        await tx
          .select()
          .from(chatBranch)
          .where(
            and(
              eq(chatBranch.id, input.branchId),
              eq(chatBranch.chatId, input.id),
              eq(chatBranch.userId, userId),
            ),
          )
      )[0];
      if (!source) throw new AppError("not_found", 404);
      const active = await tx
        .select()
        .from(chatRun)
        .where(
          and(
            eq(chatRun.chatId, input.id),
            eq(chatRun.userId, userId),
            eq(chatRun.state, "pending"),
          ),
        );
      if (active.length) throw new AppError("chat_busy", 409);
      const branchCount = await tx
        .select({ id: chatBranch.id })
        .from(chatBranch)
        .where(
          and(eq(chatBranch.chatId, input.id), eq(chatBranch.userId, userId)),
        );
      if (branchCount.length >= 100 && input.action !== "send")
        throw new AppError("branch_limit_reached", 400);
      let messages = source.messages as TypeUIMessage[];
      let branchId = source.id;
      let message = input.message;
      if (input.action !== "send") {
        const index = messages.findIndex((m) => m.id === input.anchorId);
        if (index < 0) throw new AppError("invalid_anchor", 400);
        if (input.action === "edit") {
          if (messages[index].role !== "user")
            throw new AppError("invalid_anchor", 400);
          messages = messages.slice(0, index);
        } else {
          let userIndex = index;
          if (messages[userIndex].role === "assistant") userIndex--;
          if (userIndex < 0 || messages[userIndex].role !== "user")
            throw new AppError("invalid_anchor", 400);
          message = { ...messages[userIndex], id: input.message.id };
          messages = messages.slice(0, userIndex);
        }
      }
      // Every generation needs space for its user prompt and terminal assistant,
      // including after a failed user-only turn. Forks use their actual prefix.
      if (messages.length + 2 > 500)
        throw new AppError("conversation_limit_reached", 400);
      if (input.action !== "send") {
        branchId = input.requestId;
        await tx.insert(chatBranch).values({
          id: branchId,
          chatId: input.id,
          userId,
          parentId: source.id,
          label:
            input.action === "edit"
              ? "Edited prompt"
              : input.action === "retry"
                ? "Retry"
                : "Regenerated",
          messages,
        });
      }
      if (message.role !== "user" || messages.some((m) => m.id === message.id))
        throw new AppError("duplicate_message", 409);
      messages = [...messages, message];
      await tx.insert(chatMessage).values({
        id: message.id,
        chatId: input.id,
        userId,
        role: "user",
        parts: message.parts,
        attachments: [],
      });
      await tx
        .update(chatBranch)
        .set({ messages })
        .where(and(eq(chatBranch.id, branchId), eq(chatBranch.userId, userId)));
      await tx.insert(chatRun).values({
        id: input.requestId,
        chatId: input.id,
        userId,
        branchId,
        digest,
        state: "pending",
      });
      return { branchId, messages };
    },
    { isolationLevel: "read committed" },
  );
}
export async function finishRun(
  requestId: string,
  userId: string,
  state: "complete" | "error" | "stopped",
  assistant?: TypeUIMessage,
) {
  const db = requireDb();
  await db.transaction(async (tx) => {
    const run = (
      await tx
        .select()
        .from(chatRun)
        .where(and(eq(chatRun.id, requestId), eq(chatRun.userId, userId)))
        .for("update")
    )[0];
    if (!run || run.state !== "pending") return;
    const branch = (
      await tx
        .select()
        .from(chatBranch)
        .where(
          and(eq(chatBranch.id, run.branchId), eq(chatBranch.userId, userId)),
        )
        .for("update")
    )[0];
    if (!branch) return;
    if (assistant?.parts.length) {
      await tx.insert(chatMessage).values({
        id: assistant.id,
        chatId: run.chatId,
        userId,
        role: "assistant",
        parts: assistant.parts,
        attachments: [],
      });
      await tx
        .update(chatBranch)
        .set({ messages: [...(branch.messages as TypeUIMessage[]), assistant] })
        .where(
          and(eq(chatBranch.id, run.branchId), eq(chatBranch.userId, userId)),
        );
    }
    await tx
      .update(chatRun)
      .set({ state })
      .where(and(eq(chatRun.id, requestId), eq(chatRun.userId, userId)));
    await tx
      .update(chat)
      .set({ updatedAt: new Date() })
      .where(and(eq(chat.id, run.chatId), eq(chat.userId, userId)));
  });
}
