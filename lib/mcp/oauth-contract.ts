import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { deepFreeze } from "@/lib/funding/config";
import { validateCanonicalUrl } from "./config";
import {
  digestSchema,
  identifierSchema,
  revisionIdentitySchema,
} from "./operation-contract";

export const OAUTH_PURPOSES = [
  "oauth.resource",
  "oauth.discovery",
  "oauth.token",
  "oauth.refresh",
  "oauth.revoke",
] as const;
export const OAUTH_LIMITS = {
  ownerRecords: 100,
  globalRecords: 1000,
  ownerDaily: 10,
  globalDaily: 50,
  stateMs: 600_000,
  refreshMs: 20_000,
  tokenBytes: 8192,
} as const;
const url = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      return validateCanonicalUrl(v, "oauth_url") === v;
    } catch {
      return false;
    }
  });
export const scopesSchema = z
  .array(z.string().regex(/^[a-zA-Z0-9:_./-]{1,80}$/))
  .max(10)
  .refine((v) => new Set(v).size === v.length);
export const oauthManifestSchema = z
  .object({
    id: identifierSchema,
    revision: identifierSchema,
    purpose: z.enum(OAUTH_PURPOSES),
    profile: revisionIdentitySchema,
    issuer: url,
    resource: url,
    endpoint: url,
    authorizationEndpoint: url,
    brokerEndpoint: url,
    clientId: identifierSchema,
    redirectUri: url,
    scopes: scopesSchema,
    formFields: z
      .object({
        client_id: identifierSchema,
        redirect_uri: url.optional(),
        scope: z.string().max(810).optional(),
      })
      .strict(),
    expiresAt: z.iso.datetime(),
    provenance: z.literal("synthetic-offline-untrusted"),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (
      m.formFields.client_id !== m.clientId ||
      (m.formFields.redirect_uri !== undefined &&
        m.formFields.redirect_uri !== m.redirectUri) ||
      (m.formFields.scope !== undefined &&
        m.formFields.scope !== m.scopes.join(" ")) ||
      (m.purpose === "oauth.token" &&
        m.formFields.redirect_uri !== m.redirectUri)
    )
      ctx.addIssue({ code: "custom", message: "invalid manifest binding" });
  });
export type OAuthManifest = z.infer<typeof oauthManifestSchema>;
export const sealedSecretSchema = z
  .object({
    keyVersion: identifierSchema,
    nonce: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
    ciphertext: z
      .string()
      .min(24)
      .max(11000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export type SealedOAuthSecret = z.infer<typeof sealedSecretSchema>;
export const oauthRuntimeSchema = z
  .object({
    activeKeyVersion: identifierSchema,
    keys: z
      .record(identifierSchema, z.string().regex(/^[A-Za-z0-9+/]{43}=$/))
      .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 8),
    counterSecret: z.string().min(32).max(256),
    manifests: z.array(oauthManifestSchema).min(1).max(32),
  })
  .strict()
  .refine(
    (r) =>
      Object.hasOwn(r.keys, r.activeKeyVersion) &&
      new Set(r.manifests.map((m) => m.id)).size === r.manifests.length,
  );
export type OAuthRuntime = z.infer<typeof oauthRuntimeSchema>;
export const grantInputSchema = z
  .object({
    id: z.uuid(),
    bindingId: z.uuid(),
    stateId: z.uuid(),
    expectedStateRevision: z.number().int().positive(),
    session: z.string().min(1).max(256),
    accessToken: z.string().min(1).max(8192),
    refreshToken: z.string().min(1).max(8192).nullable(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type OAuthGrantInput = z.infer<typeof grantInputSchema>;
export const callbackSchema = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    session: z.string().min(1).max(256),
    redirectUri: url,
  })
  .strict();
export const bindingInputSchema = z
  .object({
    id: z.uuid(),
    connectionId: z.uuid(),
    connectionRevision: z.uuid(),
    manifestId: identifierSchema,
    manifestDigest: digestSchema,
  })
  .strict();
export function parseOAuth<T>(schema: z.ZodType<T>, raw: unknown): Readonly<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new AppError("invalid_mcp_oauth", 400);
  return deepFreeze(result.data);
}
export function oauthUnavailable(): never {
  throw new AppError("mcp_oauth_authority_unavailable", 503);
}
export function oauthFixtureGate() {
  if (process.env.NODE_ENV !== "test") oauthUnavailable();
}
export type OAuthGrantView = Readonly<{
  id: string;
  bindingId: string;
  revision: number;
  state: "active" | "uncertain" | "revoked";
  expiresAt: string;
  hasRefreshToken: boolean;
}>;
