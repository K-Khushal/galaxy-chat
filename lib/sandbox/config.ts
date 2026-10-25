import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { EnvSource } from "@/lib/auth/env";
import { AppError } from "@/lib/errors";
import {
  canonicalJson,
  deepFreeze,
  PLATFORM_CEILING_MICRODOLLARS,
} from "@/lib/funding/config";
import { digestSchema, identifierSchema } from "./contract";

/**
 * Provider boundary. No reviewed provider currently establishes all unchanged
 * policy limits, so the catalog admits nothing: every entry documents the exact
 * unresolved reasons and every privileged production call denies with them.
 * Unknown provider IDs deny too. Zero fees, permanent free tiers and boolean
 * isolation "proof" bypasses are never invented here.
 */
export const SANDBOX_PROVIDER_CATALOG = {
  "cloudflare-containers-v1": {
    vendor: "cloudflare",
    denyReasons: [
      "sandbox_cost_baseline_unmet",
      "sandbox_disk_minimum_exceeded",
      "sandbox_lifetime_guarantee_missing",
    ],
    notes:
      "requires a $5 platform baseline; 2 GiB minimum disk versus the 128 MiB limit; inactivity shutdown is not an absolute five-minute lifetime",
  },
  "modal-v1": {
    vendor: "modal",
    denyReasons: [
      "sandbox_isolation_unproven",
      "sandbox_disk_cost_enforcement_unproven",
    ],
    notes:
      "complete disk and cost enforcement is unproven against the 128 MiB disk and reserved-fee bounds",
  },
} as const;

export type SandboxProviderId = keyof typeof SANDBOX_PROVIDER_CATALOG;

export const SANDBOX_OFFLINE_ADAPTER_ID = "offline-scripted-v1" as const;

export type SandboxProviderDecision =
  | { kind: "offline-fixture"; providerId: typeof SANDBOX_OFFLINE_ADAPTER_ID }
  | { kind: "deny"; providerId: string; reasons: readonly string[] };

/**
 * The only admission decision helper. The offline-scripted adapter is private,
 * test-only and never a provider; it exercises the real coordinator and client
 * against an offline scripted wire endpoint and is rejected outside NODE_ENV=test.
 */
export function sandboxProviderDecision(
  providerId: string,
  env: EnvSource = process.env,
): SandboxProviderDecision {
  if (providerId === SANDBOX_OFFLINE_ADAPTER_ID) {
    if (process.env.NODE_ENV !== "test" || env.NODE_ENV !== "test") {
      return {
        kind: "deny",
        providerId,
        reasons: ["sandbox_adapter_offline_only"],
      };
    }
    return { kind: "offline-fixture", providerId };
  }
  const entry = (
    SANDBOX_PROVIDER_CATALOG as Readonly<
      Record<string, { denyReasons: readonly string[] }>
    >
  )[providerId];
  if (!entry) {
    return { kind: "deny", providerId, reasons: ["sandbox_provider_unknown"] };
  }
  return {
    kind: "deny",
    providerId,
    reasons: entry.denyReasons,
  };
}

function deny(
  decision: Extract<SandboxProviderDecision, { kind: "deny" }>,
): never {
  throw new AppError(decision.reasons[0] ?? "sandbox_provider_unknown", 503);
}

/**
 * Synthetic offline fee snapshot. Basis is explicitly "synthetic-offline": it is
 * not vendor pricing. The upper bound must still cover every worst-case component
 * (startup, compute, disk, egress, logging, orphan retention, cleanup, fees) and
 * the offline endpoint never asserts real costs; authentic settlement stays separate.
 */
export const SANDBOX_LEASE_MS = 20_000;

export const sandboxFeeSnapshotSchema = z
  .object({
    id: identifierSchema,
    revision: identifierSchema,
    basis: z.literal("synthetic-offline"),
    reviewedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    proofReference: identifierSchema,
    proofDigest: digestSchema,
    upperBoundMicrodollars: z
      .number()
      .int()
      .min(1)
      .max(PLATFORM_CEILING_MICRODOLLARS),
    allInPlatformCost: z.literal(true),
    coverage: z
      .object({
        startup: z.literal(true),
        compute: z.literal(true),
        disk: z.literal(true),
        egress: z.literal(true),
        logging: z.literal(true),
        orphanRetention: z.literal(true),
        cleanup: z.literal(true),
        providerFees: z.literal(true),
      })
      .strict(),
    capacity: z
      .object({
        ownerActive: z.literal(1),
        globalActive: z.literal(2),
        ownerRecords: z.number().int().min(1).max(1000),
        globalRecords: z.number().int().min(1).max(10_000),
        leaseMs: z.literal(SANDBOX_LEASE_MS),
      })
      .strict(),
  })
  .strict();
export type SandboxFeeSnapshot = z.infer<typeof sandboxFeeSnapshotSchema>;

const runtimeSchema = z
  .object({
    providerId: z.string().min(1).max(64),
    providerAccount: identifierSchema,
    providerRegion: identifierSchema,
    gateway: z
      .object({
        baseUrl: z.string().url(),
        key: z.string().min(32).max(256),
        keyIdentity: digestSchema,
      })
      .strict(),
    fee: z.unknown(),
    activeKeyVersion: identifierSchema,
    actorKeys: z
      .record(identifierSchema, z.string().min(32).max(256))
      .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 8),
    principalSecret: z.string().min(32).max(256),
  })
  .strict();
export type SandboxRuntimeInput = z.infer<typeof runtimeSchema>;

export type SandboxRuntime = Readonly<
  Omit<SandboxRuntimeInput, "fee" | "gateway"> & {
    fee: Readonly<SandboxFeeSnapshot>;
    gateway: Readonly<{
      baseUrl: string;
      keyIdentity: string;
    }>;
    gatewayKey: string;
  }
>;

/**
 * Parse and freeze an untrusted runtime candidate. The provider decision is
 * re-evaluated here so every construction path denies in production with the
 * precise catalog reasons.
 */
export function parseSandboxRuntime(
  raw: unknown,
  env: EnvSource = process.env,
  now = new Date(),
): SandboxRuntime {
  const parsed = runtimeSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("sandbox_unconfigured", 503);
  const value = parsed.data;
  const decision = sandboxProviderDecision(value.providerId, env);
  if (decision.kind === "deny") deny(decision);
  const url = new URL(value.gateway.baseUrl);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    value.gateway.keyIdentity !==
      createHash("sha256").update(value.gateway.key).digest("hex")
  )
    throw new AppError("sandbox_gateway_unconfigured", 503);
  const fee = parseSandboxFeeSnapshot(value.fee, now);
  return deepFreeze({
    ...value,
    fee,
    gateway: {
      baseUrl: value.gateway.baseUrl,
      keyIdentity: value.gateway.keyIdentity,
    },
    gatewayKey: value.gateway.key,
  });
}

export function parseSandboxFeeSnapshot(
  raw: unknown,
  now = new Date(),
): SandboxFeeSnapshot {
  const parsed = sandboxFeeSnapshotSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("sandbox_fee_unreviewed", 503);
  const fee = parsed.data;
  if (new Date(fee.reviewedAt).getTime() > now.getTime())
    throw new AppError("sandbox_fee_reviewed_in_future", 503);
  if (new Date(fee.expiresAt).getTime() <= now.getTime())
    throw new AppError("sandbox_fee_expired", 503);
  return deepFreeze(fee);
}

/**
 * Environment resolver used by privileged production paths. With no provider
 * configured it fails with sandbox_provider_unknown; with a cataloged provider
 * it fails with that provider's precise unresolved reasons; the offline adapter
 * is only ever admitted under NODE_ENV=test.
 */
export function resolveSandboxRuntimeFromEnv(
  env: EnvSource = process.env,
  now = new Date(),
): SandboxRuntime {
  const providerId = env.SANDBOX_PROVIDER?.trim() ?? "";
  const decision = sandboxProviderDecision(providerId, env);
  if (decision.kind === "deny") deny(decision);
  const raw = {
    providerId,
    providerAccount: env.SANDBOX_PROVIDER_ACCOUNT?.trim() ?? "",
    providerRegion: env.SANDBOX_PROVIDER_REGION?.trim() ?? "",
    gateway: {
      baseUrl: env.SANDBOX_GATEWAY_URL?.trim() ?? "",
      key: env.SANDBOX_GATEWAY_KEY?.trim() ?? "",
      keyIdentity: env.SANDBOX_GATEWAY_KEY_IDENTITY?.trim() ?? "",
    },
    fee: safeJson(env.SANDBOX_FEE_SNAPSHOT_JSON),
    activeKeyVersion: env.SANDBOX_ACTIVE_ACTOR_KEY_VERSION?.trim() ?? "",
    actorKeys: safeJson(env.SANDBOX_ACTOR_KEYS_JSON),
    principalSecret: env.SANDBOX_PRINCIPAL_SECRET?.trim() ?? "",
  };
  return parseSandboxRuntime(raw, env, now);
}

function safeJson(raw: string | undefined): unknown {
  if (!raw || raw.trim() === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function sandboxOperationDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
