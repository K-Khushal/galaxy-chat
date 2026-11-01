import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { AppContext } from "@/lib/api/context";
import { loadByokKey } from "@/lib/byok/store";
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

/** The last credit went to another Generation between choosing and spending. */
export class CreditsGone extends Error {}

/**
 * Spends the credit for a Credits payment; BYOK spends nothing. Throws
 * CreditsGone when the last credit went to another Generation since
 * choosePayment, which payForReply answers by choosing again.
 */
export async function spendForReply(
  db: Db,
  userId: string,
  payment: Payment,
): Promise<void> {
  if (payment.source === "credits" && !(await spendCredit(db, userId))) {
    throw new CreditsGone();
  }
}

/**
 * Chooses who pays, then runs `record`, which must call spendForReply and
 * persist whatever the caller needs (saved Chats record the Reply in the same
 * transaction; Temporary chats store nothing). A second pass runs only when
 * `record` lost the last credit: then the BYOK key pays, or the User has
 * neither (no_credits).
 */
export async function payForReply<T>(
  ctx: Pick<AppContext, "db" | "platformKey" | "byokEnv">,
  userId: string,
  model: ResolvedModel,
  record: (payment: Payment) => Promise<T>,
): Promise<{ payment: Payment; recorded: T }> {
  const payer = {
    db: ctx.db,
    platformKey: ctx.platformKey,
    loadByokKey: (id: string) => loadByokKey(ctx.db, ctx.byokEnv, id),
  };
  for (let attempt = 0; ; attempt++) {
    const payment = await choosePayment(payer, userId, model);
    try {
      return { payment, recorded: await record(payment) };
    } catch (error) {
      if (!(error instanceof CreditsGone)) throw error;
      if (attempt > 0) throw new AppError("no_credits", 402);
    }
  }
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
