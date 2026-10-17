import type { EnvSource } from "@/lib/auth/env";
import { resolveFundingConfig } from "@/lib/credits/config";
import { AppError } from "@/lib/errors";
export function fundedInferenceEnabled(env: EnvSource): boolean {
  try {
    resolveFundingConfig(env);
    return true;
  } catch {
    return false;
  }
}
/** Legacy unmetered callbacks can never authorize a provider call. */
export async function runFundedModelCall<T>(
  env: EnvSource,
  _run: () => Promise<T>,
): Promise<T> {
  if (env.FUNDED_INFERENCE !== "1")
    throw new AppError("funded_inference_disabled", 503);
  throw new AppError("funding_reservation_required", 503);
}
