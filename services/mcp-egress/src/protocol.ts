import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign as signEd25519,
  timingSafeEqual,
} from "node:crypto";
import { fail, integer, object, text } from "./errors.js";
import { identifier, type Profile, type Purpose, purpose } from "./profile.js";

export const MAX_ENVELOPE_BYTES = 96 * 1024;
export type Credential = Readonly<{
  connectionRevision: string;
  iv: string;
  ciphertext: string;
  tag: string;
}>;
export type Envelope = Readonly<{
  version: 1;
  requestId: string;
  operationId: string;
  issuedAt: number;
  deadline: number;
  profileId: string;
  revision: string;
  purpose: Purpose;
  bodyHash: string;
  body: string;
  credential?: Credential;
}>;
export function decode64(value: unknown, max: number): Buffer {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    fail("invalid_request");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > max || bytes.toString("base64") !== value)
    fail("invalid_request");
  return bytes;
}
function uuid(value: unknown): string {
  const result = text(value, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      result,
    )
  )
    fail("invalid_request");
  return result;
}
export function parseEnvelope(value: unknown, now: number): Envelope {
  const e = object(value, [
    "version",
    "requestId",
    "operationId",
    "issuedAt",
    "deadline",
    "profileId",
    "revision",
    "purpose",
    "bodyHash",
    "body",
    "credential",
  ]);
  if (e.version !== 1) fail("invalid_request");
  const issuedAt = integer(e.issuedAt, 0, Number.MAX_SAFE_INTEGER);
  const deadline = integer(e.deadline, issuedAt + 1, issuedAt + 20_000);
  if (Math.abs(now - issuedAt) > 30_000 || deadline <= now)
    fail("authentication");
  const body = decode64(e.body, 65_536);
  if (
    typeof e.bodyHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(e.bodyHash) ||
    createHash("sha256").update(body).digest("hex") !== e.bodyHash
  )
    fail("authentication");
  let credential: Credential | undefined;
  if (e.credential !== undefined) {
    const c = object(e.credential, [
      "connectionRevision",
      "iv",
      "ciphertext",
      "tag",
    ]);
    if (
      decode64(c.iv, 12).length !== 12 ||
      decode64(c.tag, 16).length !== 16 ||
      decode64(c.ciphertext, 4096).length === 0
    )
      fail("authentication");
    credential = Object.freeze({
      connectionRevision: identifier(c.connectionRevision),
      iv: c.iv as string,
      ciphertext: c.ciphertext as string,
      tag: c.tag as string,
    });
  }
  return Object.freeze({
    version: 1,
    requestId: uuid(e.requestId),
    operationId: uuid(e.operationId),
    issuedAt,
    deadline,
    profileId: identifier(e.profileId),
    revision: identifier(e.revision),
    purpose: purpose(e.purpose),
    bodyHash: e.bodyHash,
    body: e.body as string,
    ...(credential ? { credential } : {}),
  });
}
// An explicit field order gives Node and future app clients one wire format.
export function canonical(e: Envelope | RuntimeEnvelope): string {
  if (e.version === 2)
    return JSON.stringify({
      version: 2,
      requestId: e.requestId,
      operationId: e.operationId,
      issuedAt: e.issuedAt,
      deadline: e.deadline,
      profileId: e.profileId,
      revision: e.revision,
      purpose: e.purpose,
      bodyHash: e.bodyHash,
      body: e.body,
      frameId: e.frameId,
      manifestDigest: e.manifestDigest,
      profileDigest: e.profileDigest,
      keyVersion: e.keyVersion,
    });
  return JSON.stringify({
    version: e.version,
    requestId: e.requestId,
    operationId: e.operationId,
    issuedAt: e.issuedAt,
    deadline: e.deadline,
    profileId: e.profileId,
    revision: e.revision,
    purpose: e.purpose,
    bodyHash: e.bodyHash,
    body: e.body,
    ...(e.credential
      ? {
          credential: {
            connectionRevision: e.credential.connectionRevision,
            iv: e.credential.iv,
            ciphertext: e.credential.ciphertext,
            tag: e.credential.tag,
          },
        }
      : {}),
  });
}
export function sign(e: Envelope | RuntimeEnvelope, key: Buffer): string {
  return createHmac("sha256", key)
    .update(`galaxy-mcp-egress-v${e.version}\n`)
    .update(canonical(e))
    .digest("hex");
}
export function authenticate(
  e: Envelope | RuntimeEnvelope,
  signature: unknown,
  key: Buffer,
): void {
  if (
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(sign(e, key), "hex"),
    )
  )
    fail("authentication");
}
function aad(
  e: Envelope | RuntimeEnvelope,
  p: Profile,
  connectionRevision: string,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      "galaxy-mcp-credential-v1",
      e.requestId,
      e.operationId,
      p.profileId,
      p.revision,
      p.purpose,
      connectionRevision,
      p.resource,
      p.issuer,
    ]),
  );
}
export function sealCredential(
  e: Envelope,
  p: Profile,
  connectionRevision: string,
  token: string,
  key: Buffer,
): Credential {
  identifier(connectionRevision);
  if (!/^[\x21-\x7e]{1,4000}$/.test(token)) fail("authentication");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(e, p, connectionRevision));
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return Object.freeze({
    connectionRevision,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  });
}
export function openCredential(
  e: Envelope | RuntimeEnvelope,
  p: Profile,
  key: Buffer,
): string | undefined {
  if (!e.credential) return undefined;
  try {
    const c = e.credential;
    const decipher = createDecipheriv("aes-256-gcm", key, decode64(c.iv, 12));
    decipher.setAAD(aad(e, p, c.connectionRevision));
    decipher.setAuthTag(decode64(c.tag, 16));
    const token = Buffer.concat([
      decipher.update(decode64(c.ciphertext, 4096)),
      decipher.final(),
    ]).toString("utf8");
    if (!/^[\x21-\x7e]{1,4000}$/.test(token)) fail("authentication");
    return token;
  } catch {
    fail("authentication");
  }
}

export type RuntimeEnvelope = Omit<Envelope, "version" | "credential"> & {
  version: 2;
  credential?: never;
  frameId: string;
  manifestDigest: string;
  profileDigest: string;
  keyVersion: string;
};
export function parseAnyEnvelope(
  value: unknown,
  now: number,
): Envelope | RuntimeEnvelope {
  return value &&
    typeof value === "object" &&
    Reflect.get(value, "version") === 2
    ? parseRuntimeEnvelope(value, now)
    : parseEnvelope(value, now);
}
function parseRuntimeEnvelope(value: unknown, now: number): RuntimeEnvelope {
  const e = object(value, [
    "version",
    "requestId",
    "operationId",
    "issuedAt",
    "deadline",
    "profileId",
    "revision",
    "purpose",
    "bodyHash",
    "body",
    "frameId",
    "manifestDigest",
    "profileDigest",
    "keyVersion",
  ]);
  const { frameId, manifestDigest, profileDigest, keyVersion, ...base } = e;
  if (
    !/^[a-f0-9]{64}$/.test(String(manifestDigest)) ||
    !/^[a-f0-9]{64}$/.test(String(profileDigest))
  )
    fail("invalid_request");
  const parsed = parseEnvelope({ ...base, version: 1 }, now);
  const { credential: _credential, ...withoutCredential } = parsed;
  return Object.freeze({
    ...withoutCredential,
    version: 2,
    frameId: uuid(frameId),
    manifestDigest: manifestDigest as string,
    profileDigest: profileDigest as string,
    keyVersion: identifier(keyVersion),
  });
}
export function canonicalEvidence(value: unknown): string {
  const walk = (v: unknown): unknown =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, walk(x)]),
        )
      : v;
  return JSON.stringify(walk(value));
}
export function signTransportEvidence(
  e: RuntimeEnvelope,
  response: { status: number; body: string },
  keyVersion: string,
  privateKey: string,
) {
  const now = Date.now();
  const evidence = {
    version: 2,
    operationId: e.operationId,
    frameId: e.frameId,
    requestId: e.requestId,
    manifestDigest: e.manifestDigest,
    profileDigest: e.profileDigest,
    bodyHash: e.bodyHash,
    responseHash: createHash("sha256")
      .update(Buffer.from(response.body, "base64"))
      .digest("hex"),
    status: response.status,
    purpose: e.purpose,
    phase: "terminal",
    terminal: true,
    issuedAt: now,
    expiresAt: now + 30000,
    keyVersion,
  };
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") fail("configuration");
  return {
    evidence,
    signature: signEd25519(
      null,
      Buffer.from(
        `galaxy-mcp-transport-evidence-v2\n${canonicalEvidence(evidence)}`,
      ),
      key,
    ).toString("base64"),
  };
}
