import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { keyring, openKey, sealKey } = await import("../lib/byok/crypto");

const userKey = "nonfunctional-user-key-never-sent-1111";
const ring = {
  v1: Buffer.alloc(32, 1).toString("base64"),
  v2: Buffer.alloc(32, 2).toString("base64"),
};
const env = {
  BYOK_ENCRYPTION_KEYS_JSON: JSON.stringify(ring),
  BYOK_ACTIVE_KEY_VERSION: "v1",
};
const binding = {
  userId: "alice",
  provider: "openrouter" as const,
  revision: crypto.randomUUID(),
};

test("AEAD binds owner, provider, revision and key version", () => {
  const sealed = sealKey(userKey, binding, env);
  expect(openKey(sealed, binding, env)).toBe(userKey);
  expect(sealed.ciphertext).not.toContain(userKey);
  for (const altered of [
    { ...binding, userId: "bob" },
    { ...binding, provider: "gateway" as const },
    { ...binding, revision: crypto.randomUUID() },
  ]) {
    expect(() => openKey(sealed, altered, env)).toThrow("byok_key_unavailable");
  }
  expect(() => openKey({ ...sealed, keyVersion: "v2" }, binding, env)).toThrow(
    "byok_key_unavailable",
  );
  const flipped = sealed.ciphertext.replace(
    /^./,
    sealed.ciphertext[0] === "A" ? "B" : "A",
  );
  expect(() =>
    openKey({ ...sealed, ciphertext: flipped }, binding, env),
  ).toThrow("byok_key_unavailable");
});

test("key rotation re-seals under the new version and retired keys fail closed", () => {
  const sealed = sealKey(userKey, binding, env);
  const next = { ...env, BYOK_ACTIVE_KEY_VERSION: "v2" };
  const rotated = sealKey(openKey(sealed, binding, next), binding, next);
  expect(rotated.keyVersion).toBe("v2");
  const retired = {
    ...next,
    BYOK_ENCRYPTION_KEYS_JSON: JSON.stringify({ v2: ring.v2 }),
  };
  expect(() => openKey(sealed, binding, retired)).toThrow(
    "byok_key_unavailable",
  );
  expect(openKey(rotated, binding, retired)).toBe(userKey);
});

test("malformed keyrings and provider keys are rejected", () => {
  for (const invalid of [
    "",
    JSON.stringify({ v1: "short" }),
    JSON.stringify({ v1: Buffer.alloc(31).toString("base64") }),
  ]) {
    expect(() =>
      keyring({ ...env, BYOK_ENCRYPTION_KEYS_JSON: invalid }),
    ).toThrow("byok_encryption_unavailable");
  }
  expect(() => sealKey("short", binding, env)).toThrow("invalid_provider_key");
  expect(() => sealKey(`${userKey}\n`, binding, env)).toThrow(
    "invalid_provider_key",
  );
});
