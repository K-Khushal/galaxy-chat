import { runFundedModelCall } from "@/lib/ai/funded";
import type { EnvSource } from "@/lib/auth/env";

export async function runAuthorizedFundedModelCall<T>(options: {
  authorize: () => Promise<unknown>;
  env: EnvSource;
  run: () => Promise<T>;
}): Promise<T> {
  await options.authorize();
  return runFundedModelCall(options.env, options.run);
}
