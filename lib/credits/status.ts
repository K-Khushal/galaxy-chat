import "server-only";
import type { EnvSource } from "@/lib/auth/env";
import { AppError } from "@/lib/errors";
import {
  CREDIT_MICRODOLLARS,
  DAILY_MICRODOLLARS,
  resolveFundingConfig,
  utcWindows,
  worstCaseMicrodollars,
} from "./config";
import { type Actor, CreditStore } from "./store";
export type CreditStatus = {
  funding: "platform";
  state:
    | "disabled"
    | "available"
    | "daily_exhausted"
    | "shared_exhausted"
    | "busy";
  configured: boolean;
  allowanceMicrodollars: number;
  remainingMicrodollars: number;
  creditMicrodollars: number;
  resetsAt: string;
  reason?: string;
};
export async function creditStatus(
  env: EnvSource,
  actor: Actor,
  store?: CreditStore,
  now = new Date(),
): Promise<CreditStatus> {
  const base = {
    funding: "platform" as const,
    configured: false,
    allowanceMicrodollars: DAILY_MICRODOLLARS,
    remainingMicrodollars: 0,
    creditMicrodollars: CREDIT_MICRODOLLARS,
    resetsAt: utcWindows(now).resetsAt,
  };
  try {
    const config = resolveFundingConfig(env, now);
    const balance = await (store ?? new CreditStore()).status(actor, now);
    const minimum = worstCaseMicrodollars(config.price);
    const remainingMicrodollars = Math.max(
      0,
      DAILY_MICRODOLLARS - balance.daily,
    );
    const state = balance.stopped
      ? "disabled"
      : remainingMicrodollars < minimum
        ? "daily_exhausted"
        : config.monthlyMicrodollars - balance.monthly < minimum
          ? "shared_exhausted"
          : balance.actorActive >= config.actorConcurrency ||
              balance.globalActive >= config.globalConcurrency
            ? "busy"
            : "available";
    return {
      ...base,
      configured: true,
      remainingMicrodollars,
      state,
      ...(balance.stopped ? { reason: "funded_inference_disabled" } : {}),
    };
  } catch (error) {
    return {
      ...base,
      state: "disabled",
      reason: error instanceof AppError ? error.id : "funding_unavailable",
    };
  }
}
