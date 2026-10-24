import "server-only";
import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { canonicalJson, deepFreeze } from "@/lib/funding/config";
import { digestSchema, identifierSchema } from "./operation-contract";

const evidenceSchema = z
  .object({
    version: z.literal(2),
    operationId: z.uuid(),
    frameId: z.uuid(),
    requestId: z.uuid(),
    manifestDigest: digestSchema,
    profileDigest: digestSchema,
    bodyHash: digestSchema,
    responseHash: digestSchema,
    status: z.number().int().min(200).max(299),
    purpose: z.enum(["mcp.initialize", "mcp.call"]),
    phase: z.literal("terminal"),
    terminal: z.literal(true),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    keyVersion: identifierSchema,
  })
  .strict();
export const signedEvidenceSchema = z
  .object({
    evidence: evidenceSchema,
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();
export type SignedBrokerEvidence = z.infer<typeof signedEvidenceSchema>;
export const runtimeBodyHash = (body: Uint8Array) =>
  createHash("sha256").update(body).digest("hex");
/** Only broker transport facts are authenticated here. This cannot issue billing receipts. */
export function verifyBrokerEvidence(
  raw: unknown,
  expected: {
    operationId: string;
    frameId: string;
    requestId: string;
    manifestDigest: string;
    profileDigest: string;
    bodyHash: string;
    purpose: string;
    status: number;
    responseHash: string;
    keyVersion: string;
  },
  publicKey: string,
  now: number,
) {
  try {
    const signed = signedEvidenceSchema.parse(raw),
      e = signed.evidence;
    for (const [k, v] of Object.entries(expected))
      if (Reflect.get(e, k) !== v) throw new Error();
    if (
      e.issuedAt > now + 1000 ||
      e.expiresAt <= now ||
      e.expiresAt - e.issuedAt > 30000 ||
      e.issuedAt >= e.expiresAt
    )
      throw new Error();
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !verify(
        null,
        Buffer.from(`galaxy-mcp-transport-evidence-v2\n${canonicalJson(e)}`),
        key,
        Buffer.from(signed.signature, "base64"),
      )
    )
      throw new Error();
    return deepFreeze(signed);
  } catch {
    throw new AppError("mcp_broker_evidence_rejected", 502);
  }
}
