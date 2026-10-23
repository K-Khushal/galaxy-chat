import "server-only";
import {
  createCipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  canonicalEnvelope,
  MCP_CLIENT_LIMITS,
  MCP_PURPOSES,
  type McpCredentialEnvelope,
  type McpEnvelope,
  type McpMtlsFetcher,
  McpPreEntryError,
  type McpPurpose,
} from "./contract";

export type McpReviewedProfile = Readonly<{
  profileId: string;
  revision: string;
  purpose: McpPurpose;
  resource: string;
  issuer: string;
  credential: "none" | "bearer" | "refresh" | "revoke";
  maxRequestBytes: number;
  maxResponseBytes: number;
  timeoutMs: number;
  expiresAt: string;
}>;

export type McpClientConfig = Readonly<{
  brokerUrl: URL;
  endpoint: string;
  profiles: ReadonlyMap<string, McpReviewedProfile>;
  binding: McpMtlsFetcher;
  signEnvelope: (envelope: McpEnvelope) => string;
  sealToken: (
    envelope: McpEnvelope,
    profile: McpReviewedProfile,
    connectionRevision: string,
    token: string,
  ) => McpCredentialEnvelope;
  getProfile: (
    profileId: string,
    revision: string,
    purpose: McpPurpose,
    now?: number,
  ) => McpReviewedProfile;
}>;

export function profileKey(
  profileId: string,
  revision: string,
  purpose: string,
): string {
  return `${profileId}::${revision}::${purpose}`;
}

const IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]{1,80}$/;

export function validateIdentifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !IDENTIFIER_REGEX.test(value)) {
    throw new McpPreEntryError(`invalid_${name}`);
  }
  return value;
}

export function validateCanonicalUrl(raw: unknown, name: string): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    throw new McpPreEntryError(`invalid_${name}`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpPreEntryError(`invalid_${name}`);
  }
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.includes(":") ||
    host.endsWith(".") ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(
      host,
    ) ||
    host.split(".").some((label) => label.startsWith("xn--")) ||
    /\.(localhost|local|internal|invalid|test)$/.test(host) ||
    raw !== `${url.origin}${url.pathname}`
  ) {
    throw new McpPreEntryError(`invalid_${name}`);
  }
  return raw;
}

export function validateBrokerUrl(raw: unknown): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    throw new McpPreEntryError("invalid_broker_url");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpPreEntryError("invalid_broker_url");
  }
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.includes(":") ||
    host.endsWith(".") ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(
      host,
    ) ||
    host.split(".").some((label) => label.startsWith("xn--")) ||
    /\.(localhost|local|internal|invalid|test)$/.test(host) ||
    url.pathname !== "/v1/egress" ||
    raw !== `${url.origin}/v1/egress`
  ) {
    throw new McpPreEntryError("invalid_broker_url");
  }
  return url;
}

export function decodeCanonicalSecret(
  value: unknown,
  name: string,
): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new McpPreEntryError(`invalid_${name}`);
  }
  const buf = Buffer.from(value, "base64");
  if (buf.length !== 32 || buf.toString("base64") !== value) {
    throw new McpPreEntryError(`invalid_${name}`);
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function parseProfileEntry(raw: unknown): McpReviewedProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new McpPreEntryError("invalid_profile");
  }
  const rec = raw as Record<string, unknown>;
  const allowedKeys = [
    "profileId",
    "revision",
    "purpose",
    "resource",
    "issuer",
    "credential",
    "maxRequestBytes",
    "maxResponseBytes",
    "timeoutMs",
    "expiresAt",
  ];
  for (const k of Object.keys(rec)) {
    if (!allowedKeys.includes(k)) {
      throw new McpPreEntryError("invalid_profile");
    }
  }

  const profileId = validateIdentifier(rec.profileId, "profile_id");
  const revision = validateIdentifier(rec.revision, "profile_revision");
  if (
    typeof rec.purpose !== "string" ||
    !MCP_PURPOSES.includes(rec.purpose as McpPurpose)
  ) {
    throw new McpPreEntryError("invalid_purpose");
  }
  const purpose = rec.purpose as McpPurpose;
  const resource = validateCanonicalUrl(rec.resource, "resource");
  const issuer = validateCanonicalUrl(rec.issuer, "issuer");

  if (
    typeof rec.credential !== "string" ||
    !["none", "bearer", "refresh", "revoke"].includes(rec.credential)
  ) {
    throw new McpPreEntryError("invalid_credential_type");
  }
  const credential = rec.credential as "none" | "bearer" | "refresh" | "revoke";

  if (
    typeof rec.maxRequestBytes !== "number" ||
    !Number.isSafeInteger(rec.maxRequestBytes) ||
    rec.maxRequestBytes < 1 ||
    rec.maxRequestBytes > MCP_CLIENT_LIMITS.maxRequestBytes
  ) {
    throw new McpPreEntryError("invalid_max_request_bytes");
  }
  const maxRequestBytes = rec.maxRequestBytes;

  if (
    typeof rec.maxResponseBytes !== "number" ||
    !Number.isSafeInteger(rec.maxResponseBytes) ||
    rec.maxResponseBytes < 1 ||
    rec.maxResponseBytes > MCP_CLIENT_LIMITS.maxDecodedBodyBytes
  ) {
    throw new McpPreEntryError("invalid_max_response_bytes");
  }
  const maxResponseBytes = rec.maxResponseBytes;

  if (
    typeof rec.timeoutMs !== "number" ||
    !Number.isSafeInteger(rec.timeoutMs) ||
    rec.timeoutMs < 100 ||
    rec.timeoutMs > MCP_CLIENT_LIMITS.maxTimeoutMs
  ) {
    throw new McpPreEntryError("invalid_timeout_ms");
  }
  const timeoutMs = rec.timeoutMs;

  if (typeof rec.expiresAt !== "string") {
    throw new McpPreEntryError("invalid_expires_at");
  }
  const expiryTime = new Date(rec.expiresAt).getTime();
  if (Number.isNaN(expiryTime) || !rec.expiresAt.includes("T")) {
    throw new McpPreEntryError("invalid_expires_at");
  }
  const expiresAt = rec.expiresAt;

  return Object.freeze({
    profileId,
    revision,
    purpose,
    resource,
    issuer,
    credential,
    maxRequestBytes,
    maxResponseBytes,
    timeoutMs,
    expiresAt,
  });
}

export function parseProfilesJson(
  rawJson: string | undefined,
): ReadonlyMap<string, McpReviewedProfile> {
  if (!rawJson || rawJson.trim() === "") {
    throw new McpPreEntryError("mcp_profiles_missing");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new McpPreEntryError("invalid_profiles_json");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > MCP_CLIENT_LIMITS.maxProfiles
  ) {
    throw new McpPreEntryError("invalid_profiles_json");
  }
  const map = new Map<string, McpReviewedProfile>();
  for (const item of parsed) {
    const profile = parseProfileEntry(item);
    const key = profileKey(
      profile.profileId,
      profile.revision,
      profile.purpose,
    );
    if (map.has(key)) {
      throw new McpPreEntryError("duplicate_profile_entry");
    }
    map.set(key, profile);
  }
  return map;
}

function resolveMtlsBinding(injectedBinding?: McpMtlsFetcher): McpMtlsFetcher {
  if (injectedBinding && typeof injectedBinding.fetch === "function") {
    return injectedBinding;
  }
  try {
    const cfContext = getCloudflareContext();
    const binding = (cfContext?.env as Record<string, unknown> | undefined)
      ?.MCP_EGRESS_MTLS as McpMtlsFetcher | undefined;
    if (binding && typeof binding.fetch === "function") {
      return binding;
    }
  } catch {
    // Cloudflare context unavailable outside Worker runtime
  }
  throw new McpPreEntryError("mcp_binding_missing", 503);
}

export type McpConfigOptions = {
  env?: Record<string, string | undefined>;
  binding?: McpMtlsFetcher;
  now?: () => number;
};

export function resolveMcpClientConfig(
  options: McpConfigOptions = {},
): McpClientConfig | undefined {
  const env = options.env ?? process.env;
  if (env.MCP_CLIENT_ENABLED !== "1") {
    return undefined;
  }

  const brokerUrl = validateBrokerUrl(env.MCP_CLIENT_BROKER_URL);
  const canonicalEndpoint = brokerUrl.href;
  const profilesInternal = parseProfilesJson(env.MCP_CLIENT_PROFILES_JSON);
  const hmacKeyBytes = decodeCanonicalSecret(
    env.MCP_CLIENT_HMAC_KEY,
    "hmac_key",
  );
  const envelopeKeyBytes = decodeCanonicalSecret(
    env.MCP_CLIENT_ENVELOPE_KEY,
    "envelope_key",
  );

  if (
    timingSafeEqual(Buffer.from(hmacKeyBytes), Buffer.from(envelopeKeyBytes))
  ) {
    throw new McpPreEntryError("identical_mcp_keys");
  }

  const binding = resolveMtlsBinding(options.binding);
  const clock = options.now ?? Date.now;

  const immutableProfiles: ReadonlyMap<string, McpReviewedProfile> =
    Object.freeze({
      get: (key: string) => {
        const p = profilesInternal.get(key);
        return p ? Object.freeze({ ...p }) : undefined;
      },
      has: (key: string) => profilesInternal.has(key),
      entries: () => profilesInternal.entries(),
      keys: () => profilesInternal.keys(),
      values: () => profilesInternal.values(),
      forEach: (
        cb: (
          value: McpReviewedProfile,
          key: string,
          map: ReadonlyMap<string, McpReviewedProfile>,
        ) => void,
      ) => {
        profilesInternal.forEach((val, k) => {
          cb(Object.freeze({ ...val }), k, immutableProfiles);
        });
      },
      [Symbol.iterator]: () => profilesInternal[Symbol.iterator](),
      get size() {
        return profilesInternal.size;
      },
    });

  const signEnvelope = (envelope: McpEnvelope): string => {
    return createHmac("sha256", Buffer.from(hmacKeyBytes))
      .update("galaxy-mcp-egress-v1\n")
      .update(canonicalEnvelope(envelope))
      .digest("hex");
  };

  const sealToken = (
    envelope: McpEnvelope,
    profile: McpReviewedProfile,
    connectionRevision: string,
    token: string,
  ): McpCredentialEnvelope => {
    validateIdentifier(connectionRevision, "connection_revision");
    if (typeof token !== "string" || !/^[\x21-\x7e]{1,4000}$/.test(token)) {
      throw new McpPreEntryError("invalid_credential_token");
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(envelopeKeyBytes),
      iv,
    );
    const aad = Buffer.from(
      JSON.stringify([
        "galaxy-mcp-credential-v1",
        envelope.requestId,
        envelope.operationId,
        profile.profileId,
        profile.revision,
        profile.purpose,
        connectionRevision,
        profile.resource,
        profile.issuer,
      ]),
    );
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(token, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return Object.freeze({
      connectionRevision,
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: tag.toString("base64"),
    });
  };

  const getProfile = (
    profileId: string,
    revision: string,
    purpose: McpPurpose,
    overrideNow?: number,
  ): McpReviewedProfile => {
    const key = profileKey(profileId, revision, purpose);
    const profile = profilesInternal.get(key);
    if (!profile) {
      throw new McpPreEntryError("profile_not_found", 404);
    }
    const currentTime = overrideNow ?? clock();
    if (new Date(profile.expiresAt).getTime() <= currentTime) {
      throw new McpPreEntryError("profile_expired", 400);
    }
    return profile;
  };

  // Return frozen configuration object without exposing secrets
  return Object.freeze({
    get brokerUrl() {
      return new URL(canonicalEndpoint);
    },
    endpoint: canonicalEndpoint,
    profiles: immutableProfiles,
    binding,
    signEnvelope,
    sealToken,
    getProfile,
    toString: () => "[McpClientConfig: active]",
    toJSON: () => ({
      brokerUrl: canonicalEndpoint,
      endpoint: canonicalEndpoint,
      profilesCount: profilesInternal.size,
    }),
  });
}
