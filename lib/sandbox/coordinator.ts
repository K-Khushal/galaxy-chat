import "server-only";
import type { EnvSource } from "@/lib/auth/env";
import type { Database } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import type { SandboxLease } from "./contract";
import type { SandboxGatewayClient } from "./gateway-client";
import { SandboxStore } from "./store";

export type SandboxCoordinator = Readonly<{
  store: SandboxStore;
  checkpoint: (lease: SandboxLease) => Promise<void>;
}>;

export type SandboxCoordinatorOptions = Readonly<{
  db: Database;
  /** Raw runtime candidate; re-parsed under the authoritative clock on every call. */
  runtime: () => unknown;
  env?: () => EnvSource;
  gateway: SandboxGatewayClient;
}>;

/**
 * Private test-only coordinator for the offline-scripted wire endpoint. It is
 * deliberately unusable outside NODE_ENV=test: production has no provider
 * adapter, so nothing may register a checkpoint handler or construct a client.
 * The returned checkpoint is registered against the durable jobs action
 * registry by the test; it owns its fencing across every transaction.
 */
export function createSandboxCoordinator(
  options: SandboxCoordinatorOptions,
): SandboxCoordinator {
  if (process.env.NODE_ENV !== "test")
    throw new AppError("sandbox_coordinator_offline_only", 503);
  const store = new SandboxStore(
    options.db,
    options.runtime,
    options.env ?? (() => process.env),
  );
  const checkpoint = async (lease: SandboxLease) =>
    store.dispatch(lease, options.gateway);
  return Object.freeze({ store, checkpoint });
}
