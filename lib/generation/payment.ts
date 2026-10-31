import "server-only";
import { refundCredit, spendCredit } from "@/lib/credits";
import type { PaymentSource } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { AppError } from "@/lib/errors";
import type { ResolvedModel } from "@/lib/models";

export type Payment = { source: PaymentSource; apiKey: string };

/**
 * Picks who pays, with no selector (ADR 0003): on a Credit model, Credits
 * while any remain (one is spent here), then the BYOK key; on any other
 * model, the BYOK key.
 */
export async function takePayment(
  input: {
    db: Db;
    platformKey: () => string;
    loadByokKey: (userId: string) => Promise<string | null>;
  },
  userId: string,
  model: ResolvedModel,
): Promise<Payment> {
  if (model.creditModel && (await spendCredit(input.db, userId))) {
    try {
      return { source: "credits", apiKey: input.platformKey() };
    } catch (error) {
      // No key to pay with: the Reply never starts, so the credit comes back.
      await refundCredit(input.db, userId);
      throw error;
    }
  }
  const key = await input.loadByokKey(userId);
  if (key) return { source: "byok", apiKey: key };
  throw new AppError(model.creditModel ? "no_credits" : "needs_byok_key", 402);
}

/** Gives back the credit taken by takePayment, if Credits paid. */
export async function refundPayment(db: Db, userId: string, payment: Payment) {
  if (payment.source === "credits") await refundCredit(db, userId);
}
