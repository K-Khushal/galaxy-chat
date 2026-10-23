import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
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
export function canonical(e: Envelope): string {
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
export function sign(e: Envelope, key: Buffer): string {
  return createHmac("sha256", key)
    .update("galaxy-mcp-egress-v1\n")
    .update(canonical(e))
    .digest("hex");
}
export function authenticate(
  e: Envelope,
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
function aad(e: Envelope, p: Profile, connectionRevision: string): Buffer {
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
  e: Envelope,
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
