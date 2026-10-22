import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EnvSource } from "@/lib/auth/env";
import { keyring, type SealedKey, validateKey } from "@/lib/byok/crypto";
import { AppError } from "@/lib/errors";

type Binding = {
  userId: string;
  provider: "tavily";
  revision: string;
};
function aad(binding: Binding, version: string) {
  return Buffer.from(
    JSON.stringify([
      "galaxy-search-aes256gcm-v1",
      binding.userId,
      binding.provider,
      version,
      binding.revision,
    ]),
  );
}
export function sealSearchKey(
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
export function openSearchKey(
  sealed: SealedKey,
  binding: Binding,
  env: EnvSource,
) {
  const ring = keyring(env);
  try {
    const secret = ring.keys.get(sealed.keyVersion);
    const nonce = Buffer.from(sealed.nonce, "base64");
    const encrypted = Buffer.from(sealed.ciphertext, "base64");
    if (!secret || nonce.length !== 12 || encrypted.length < 48)
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
    throw new AppError("search_key_unavailable", 503);
  }
}
