import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EnvSource } from "@/lib/auth/env";
import { AppError } from "@/lib/errors";
import type { ByokProvider } from "./contract";

export type SealedKey = {
  keyVersion: string;
  nonce: string;
  ciphertext: string;
};
type Binding = { userId: string; provider: ByokProvider; revision: string };
export function keyring(env: EnvSource) {
  try {
    const raw = env.BYOK_ENCRYPTION_KEYS_JSON ?? "";
    if (raw.length > 4000) throw new Error();
    const parsed: unknown = JSON.parse(raw);
    const active = env.BYOK_ACTIVE_KEY_VERSION ?? "";
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    const entries = Object.entries(parsed);
    if (!entries.length || entries.length > 16) throw new Error();
    const keys = new Map<string, Buffer>();
    for (const [version, value] of entries) {
      if (
        !/^[a-zA-Z0-9_-]{1,40}$/.test(version) ||
        typeof value !== "string" ||
        !/^[A-Za-z0-9+/]{43}=$/.test(value)
      )
        throw new Error();
      const bytes = Buffer.from(value, "base64");
      if (bytes.length !== 32 || bytes.toString("base64") !== value)
        throw new Error();
      keys.set(version, bytes);
    }
    if (!keys.has(active)) throw new Error();
    return { keys, active };
  } catch {
    throw new AppError("byok_encryption_unavailable", 503);
  }
}
export function validateKey(key: string) {
  if (!/^[\x21-\x7e]{32,512}$/.test(key))
    throw new AppError("invalid_provider_key", 400);
  return key;
}
function aad(binding: Binding, version: string) {
  return Buffer.from(
    JSON.stringify([
      "galaxy-byok-aes256gcm-v1",
      binding.userId,
      binding.provider,
      version,
      binding.revision,
    ]),
  );
}
export function sealKey(
  key: string,
  binding: Binding,
  env: EnvSource,
): SealedKey {
  validateKey(key);
  const ring = keyring(env);
  const nonce = randomBytes(12);
  const secret = ring.keys.get(ring.active);
  if (!secret) throw new AppError("byok_encryption_unavailable", 503);
  const cipher = createCipheriv("aes-256-gcm", secret, nonce);
  cipher.setAAD(aad(binding, ring.active));
  const ciphertext = Buffer.concat([
    cipher.update(key, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    keyVersion: ring.active,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
export function openKey(
  sealed: SealedKey,
  binding: Binding,
  env: EnvSource,
): string {
  const ring = keyring(env);
  try {
    const secret = ring.keys.get(sealed.keyVersion);
    if (
      !secret ||
      !/^[A-Za-z0-9+/]{16}$/.test(sealed.nonce) ||
      sealed.ciphertext.length > 800 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(sealed.ciphertext)
    )
      throw new Error();
    const nonce = Buffer.from(sealed.nonce, "base64");
    const encrypted = Buffer.from(sealed.ciphertext, "base64");
    if (
      nonce.length !== 12 ||
      encrypted.length < 48 ||
      encrypted.toString("base64") !== sealed.ciphertext
    )
      throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", secret, nonce);
    cipher.setAAD(aad(binding, sealed.keyVersion));
    cipher.setAuthTag(encrypted.subarray(-16));
    return validateKey(
      Buffer.concat([
        cipher.update(encrypted.subarray(0, -16)),
        cipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new AppError("byok_key_unavailable", 503);
  }
}
