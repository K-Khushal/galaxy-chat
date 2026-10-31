import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { AppContext } from "@/lib/api/context";
import { hasContent, type MessageParts } from "@/lib/chat/store";
import { chat, message } from "@/lib/db/schema";
import { logErrorId } from "@/lib/errors";
import { getActiveGeneration } from "@/lib/generation/locks";
import { refundReplyCredit } from "@/lib/generation/payment";

/**
 * Settles the User's Replies whose Generation died after spending a credit
 * but before its first token (e.g. the function crashed between the payment
 * transaction and the model's first chunk). Runs lazily, whenever a Chat is
 * loaded or a Generation starts; there is no cron.
 *
 * A Reply qualifies when Credits paid, no first token arrived, the credit was
 * not refunded, it is still Interrupted (finished Replies settled their own
 * credit) and no lock is held for its Generation. Each is refunded through the
 * same once-only path a live Generation uses, then ends as Failed (or stays
 * Interrupted when it already had text from an earlier Generation). Clearing
 * its Generation fences out a producer that lost its lock but still runs.
 * Returns how many credits were given back.
 */
export async function recoverReplies(
  ctx: Pick<AppContext, "db" | "kv">,
  userId: string,
): Promise<number> {
  const candidates = await ctx.db
    .select({
      id: message.id,
      chatId: message.chatId,
      generationId: message.generationId,
      parts: message.parts,
    })
    .from(message)
    .innerJoin(chat, eq(chat.id, message.chatId))
    .where(
      and(
        eq(chat.userId, userId),
        eq(message.payment, "credits"),
        isNull(message.firstTokenAt),
        eq(message.creditRefunded, false),
        eq(message.status, "interrupted"),
        isNotNull(message.generationId),
      ),
    );

  let refunded = 0;
  for (const row of candidates) {
    const generationId = row.generationId as string;
    const active = await getActiveGeneration(ctx.kv, row.chatId);
    if (active?.generationId === generationId) continue;
    const owner = { replyId: row.id, generationId };
    const done = await ctx.db.transaction(async (tx) => {
      if (!(await refundReplyCredit(tx, owner, userId))) return false;
      const parts = row.parts as MessageParts;
      const text = hasContent(parts);
      await tx
        .update(message)
        .set({
          status: text ? "interrupted" : "failed",
          error: text ? null : "generation_failed",
          generationId: null,
          updatedAt: new Date(),
        })
        .where(eq(message.id, row.id));
      return true;
    });
    if (done) refunded++;
  }
  return refunded;
}

/** recoverReplies for a request path: a failure is logged, never fatal. */
export async function recoverRepliesQuietly(
  ctx: Pick<AppContext, "db" | "kv">,
  userId: string,
) {
  await recoverReplies(ctx, userId).catch(() =>
    logErrorId("credit_recovery_failed"),
  );
}
