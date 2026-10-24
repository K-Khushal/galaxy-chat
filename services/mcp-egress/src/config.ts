import { createPrivateKey, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fail, integer } from "./errors.js";
import { type Profile, parseProfiles } from "./profile.js";
import { decode64 } from "./protocol.js";

export type BrokerConfig = Readonly<{
  bind: string;
  port: number;
  production: boolean;
  hmacKey: Buffer;
  envelopeKey: Buffer;
  profiles: readonly Profile[];
  secrets: Readonly<Record<string, string>>;
  concurrency: number;
  maxConnections: number;
  evidence?: Readonly<{ keyVersion: string; privateKey: string }>;
  tls?: Readonly<{ key: Buffer; cert: Buffer; ca: Buffer }>;
  databaseUrl?: string;
}>;
export function loopback(bind: string): boolean {
  return bind === "127.0.0.1" || bind === "::1";
}
export function validateConfig(config: BrokerConfig): void {
  if (
    config.hmacKey.length !== 32 ||
    config.envelopeKey.length !== 32 ||
    timingSafeEqual(config.hmacKey, config.envelopeKey)
  )
    fail("configuration");
  integer(config.port, 0, 65535);
  integer(config.concurrency, 1, 32);
  integer(config.maxConnections, config.concurrency, 128);
  if (!loopback(config.bind) && !config.tls) fail("configuration");
  if (config.evidence) {
    if (
      !/^[a-zA-Z0-9_-]{1,80}$/.test(config.evidence.keyVersion) ||
      createPrivateKey(config.evidence.privateKey).asymmetricKeyType !==
        "ed25519"
    )
      fail("configuration");
  }
  for (const p of config.profiles) {
    if (p.runtime && !config.evidence) fail("configuration");
    if (
      p.clientSecretRef &&
      !/^[\x21-\x7e]{1,4000}$/.test(config.secrets[p.clientSecretRef] ?? "")
    )
      fail("configuration");
  }
}
export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
): BrokerConfig | undefined {
  if (env.MCP_EGRESS_BROKER_ENABLED !== "1") return undefined;
  try {
    const allowed = new Set([
      "MCP_EGRESS_EVIDENCE_KEY_FILE",
      "MCP_EGRESS_EVIDENCE_KEY_VERSION",
      "MCP_EGRESS_BROKER_ENABLED",
      "MCP_EGRESS_BIND",
      "MCP_EGRESS_PORT",
      "MCP_EGRESS_REMOTE_BIND",
      "MCP_EGRESS_HMAC_KEY",
      "MCP_EGRESS_ENVELOPE_KEY",
      "MCP_EGRESS_PROFILES_FILE",
      "MCP_EGRESS_SECRETS_FILE",
      "MCP_EGRESS_TLS_KEY_FILE",
      "MCP_EGRESS_TLS_CERT_FILE",
      "MCP_EGRESS_CLIENT_CA_FILE",
      "MCP_EGRESS_DATABASE_URL",
      "MCP_EGRESS_CONCURRENCY",
      "MCP_EGRESS_MAX_CONNECTIONS",
    ]);
    if (
      Object.keys(env).some(
        (name) => name.startsWith("MCP_EGRESS_") && !allowed.has(name),
      )
    )
      fail("configuration");
    const bind = env.MCP_EGRESS_BIND ?? "127.0.0.1";
    // No listen-time DNS resolution or alternate numeric spellings.
    if (!["127.0.0.1", "::1", "0.0.0.0", "::"].includes(bind))
      fail("configuration");
    const read = (name: string) => {
      const path = env[name];
      if (!path) fail("configuration");
      return readFileSync(path);
    };
    let tls: BrokerConfig["tls"];
    const tlsKeys = [
      "MCP_EGRESS_TLS_KEY_FILE",
      "MCP_EGRESS_TLS_CERT_FILE",
      "MCP_EGRESS_CLIENT_CA_FILE",
    ];
    if (tlsKeys.some((name) => env[name]))
      tls = Object.freeze({
        key: read(tlsKeys[0]),
        cert: read(tlsKeys[1]),
        ca: read(tlsKeys[2]),
      });
    if (!loopback(bind) && (env.MCP_EGRESS_REMOTE_BIND !== "1" || !tls))
      fail("configuration");
    const hmacKey = decode64(env.MCP_EGRESS_HMAC_KEY, 32);
    const envelopeKey = decode64(env.MCP_EGRESS_ENVELOPE_KEY, 32);
    const profiles = parseProfiles(
      JSON.parse(read("MCP_EGRESS_PROFILES_FILE").toString("utf8")),
    );
    let secrets: Record<string, string> = {};
    if (env.MCP_EGRESS_SECRETS_FILE) {
      const value: unknown = JSON.parse(
        read("MCP_EGRESS_SECRETS_FILE").toString("utf8"),
      );
      if (!value || typeof value !== "object" || Array.isArray(value))
        fail("configuration");
      secrets = value as Record<string, string>;
      const refs = new Set(
        profiles.map((p) => p.clientSecretRef).filter(Boolean),
      );
      if (
        Object.entries(secrets).some(
          ([name, value]) => !refs.has(name) || typeof value !== "string",
        )
      )
        fail("configuration");
    }
    const config = Object.freeze({
      bind,
      port: integer(Number(env.MCP_EGRESS_PORT ?? 8788), 1, 65535),
      production: env.NODE_ENV !== "development" && env.NODE_ENV !== "test",
      hmacKey,
      envelopeKey,
      ...(env.MCP_EGRESS_EVIDENCE_KEY_FILE
        ? {
            evidence: Object.freeze({
              keyVersion: env.MCP_EGRESS_EVIDENCE_KEY_VERSION ?? "",
              privateKey: read("MCP_EGRESS_EVIDENCE_KEY_FILE").toString("utf8"),
            }),
          }
        : {}),
      profiles,
      secrets: Object.freeze(secrets),
      concurrency: integer(Number(env.MCP_EGRESS_CONCURRENCY ?? 4), 1, 32),
      maxConnections: integer(
        Number(env.MCP_EGRESS_MAX_CONNECTIONS ?? 32),
        1,
        128,
      ),
      ...(tls ? { tls } : {}),
      ...(env.MCP_EGRESS_DATABASE_URL
        ? { databaseUrl: env.MCP_EGRESS_DATABASE_URL }
        : {}),
    });
    validateConfig(config);
    return config;
  } catch {
    fail("configuration");
  }
}
