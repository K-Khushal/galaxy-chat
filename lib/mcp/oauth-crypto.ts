import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { AppError } from "@/lib/errors";
import {
  OAUTH_LIMITS,
  type OAuthRuntime,
  oauthFixtureGate,
  type SealedOAuthSecret,
} from "./oauth-contract";
export type OAuthSecretBinding = Readonly<{
  ownerId: string;
  connectionId: string;
  connectionRevision: string;
  grantId: string;
  profileDigest: string;
  manifestDigest: string;
  credentialRevision: number;
  kind: "access" | "refresh" | "pkce";
  sessionHash?: string;
}>;
export function oauthHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function newPkce() {
  oauthFixtureGate();
  const verifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(32).toString("base64url"),
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}
function key(runtime: OAuthRuntime, version: string) {
  const raw = runtime.keys[version];
  if (typeof raw !== "string")
    throw new AppError("mcp_oauth_key_unavailable", 503);
  const value = Buffer.from(raw, "base64");
  if (value.length !== 32 || value.toString("base64") !== raw)
    throw new AppError("mcp_oauth_key_unavailable", 503);
  return value;
}
function aad(binding: OAuthSecretBinding, version: string) {
  return Buffer.from(
    JSON.stringify([
      "galaxy-mcp-oauth-aes256gcm-v1",
      binding.ownerId,
      binding.connectionId,
      binding.connectionRevision,
      binding.grantId,
      binding.profileDigest,
      binding.manifestDigest,
      binding.credentialRevision,
      binding.kind,
      binding.sessionHash ?? "",
      version,
    ]),
  );
}
function token(value: string) {
  if (
    !value ||
    Buffer.byteLength(value, "utf8") > OAUTH_LIMITS.tokenBytes ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    }) ||
    Buffer.from(value).toString("utf8") !== value
  )
    throw new AppError("invalid_mcp_oauth_secret", 400);
  return value;
}
export function sealOAuthSecret(
  value: string,
  binding: OAuthSecretBinding,
  runtime: OAuthRuntime,
): SealedOAuthSecret {
  oauthFixtureGate();
  token(value);
  const nonce = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      key(runtime, runtime.activeKeyVersion),
      nonce,
    );
  cipher.setAAD(aad(binding, runtime.activeKeyVersion));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    keyVersion: runtime.activeKeyVersion,
    nonce: nonce.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}
export function openOAuthSecret(
  sealed: SealedOAuthSecret,
  binding: OAuthSecretBinding,
  runtime: OAuthRuntime,
): string {
  oauthFixtureGate();
  try {
    const nonce = Buffer.from(sealed.nonce, "base64"),
      encrypted = Buffer.from(sealed.ciphertext, "base64");
    if (
      nonce.length !== 12 ||
      nonce.toString("base64") !== sealed.nonce ||
      encrypted.length < 17 ||
      encrypted.length > OAUTH_LIMITS.tokenBytes + 16 ||
      encrypted.toString("base64") !== sealed.ciphertext
    )
      throw new Error();
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key(runtime, sealed.keyVersion),
      nonce,
    );
    cipher.setAAD(aad(binding, sealed.keyVersion));
    cipher.setAuthTag(encrypted.subarray(-16));
    return token(
      Buffer.concat([
        cipher.update(encrypted.subarray(0, -16)),
        cipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new AppError("mcp_oauth_key_unavailable", 503);
  }
}
