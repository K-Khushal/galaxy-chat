import type { EnvSource } from "@/lib/auth/env";
import { AppError } from "@/lib/errors";

export function fundedInferenceEnabled(env: EnvSource): boolean {
  return env.FUNDED_INFERENCE === "1";
}

export async function runFundedModelCall<T>(
  env: EnvSource,
  run: () => Promise<T>,
): Promise<T> {
  if (!fundedInferenceEnabled(env)) {
    throw new AppError("funded_inference_disabled", 503);
  }
  return run();
}
