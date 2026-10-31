import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getCredits, refundCredit, spendCredit } from "@/lib/credits";
import { message, type PaymentSource } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { AppError } from "@/lib/errors";
import type { ResolvedModel } from "@/lib/models";

export type Payment = { source: PaymentSource; apiKey: string };

/**
 * Picks who pays, with no selector (ADR 0003): on a Credit model, Credits
 * while any remain, then the BYOK key; on any other model, the BYOK key.
 * Spends nothing: the credit is spent by spendForReply, in the transaction
 * that records the Reply, so no credit is ever taken without a record.
 */
export async function choosePayment(
  input: {
    db: Db;
    platformKey: () => string;
    loadByokKey: (userId: string) => Promise<string | null>;
  },
  userId: string,
  model: ResolvedModel,
): Promise<Payment> {
  if (model.creditModel && (await getCredits(input.db, userId)) > 0) {
    // Read before anything is spent: a missing key costs the User nothing.
    return { source: "credits", apiKey: input.platformKey() };
  }
  const key = await input.loadByokKey(userId);
  if (key) return { source: "byok", apiKey: key };
  throw new AppError(model.creditModel ? "no_credits" : "needs_byok_key", 402);
}

/**
 * Spends the credit for a Credits payment inside the Reply's transaction.
 * False when the last credit went to another Generation since choosePayment.
 */
export async function spendForReply(
  tx: Db,
  userId: string,
  payment: Payment,
): Promise<boolean> {
  return payment.source !== "credits" || spendCredit(tx, userId);
}

/**
 * Gives back the credit a Reply's Generation spent, at most once: only while
 * Credits paid, the Generation still owns the Reply, no first token arrived
 * and it was not refunded yet. Run inside a transaction; true if refunded.
 */
export async function refundReplyCredit(
  tx: Db,
  owner: { replyId: string; generationId: string },
  userId: string,
): Promise<boolean> {
  const rows = await tx
    .update(message)
    .set({ creditRefunded: true })
    .where(
      and(
        eq(message.id, owner.replyId),
        eq(message.generationId, owner.generationId),
        eq(message.payment, "credits"),
        isNull(message.firstTokenAt),
        eq(message.creditRefunded, false),
      ),
    )
    .returning({ id: message.id });
  if (rows.length === 0) return false;
  await refundCredit(tx, userId);
  return true;
}
