import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { McpClientConfig, McpReviewedProfile } from "./config";
import {
  canonicalEnvelope,
  MCP_ALLOWED_RESPONSE_HEADERS,
  MCP_CLIENT_LIMITS,
  type McpClientRequest,
  type McpCredentialEnvelope,
  type McpEgressResult,
  type McpEnvelope,
  McpOutcomeUnknownError,
  McpPreEntryError,
} from "./contract";

export type McpBrokerClient = Readonly<{
  dispatch: (request: McpClientRequest) => Promise<McpEgressResult>;
}>;

function isValidIpAddress(ip: string): boolean {
  if (
    typeof ip !== "string" ||
    ip.length === 0 ||
    ip.length > 45 ||
    ip.includes("%")
  ) {
    return false;
  }
  const family = isIP(ip);
  return family === 4 || family === 6;
}

export function createMcpBrokerClient(
  config: McpClientConfig,
): McpBrokerClient {
  return Object.freeze({
    async dispatch(request: McpClientRequest): Promise<McpEgressResult> {
      // 1. PRE-ENTRY VALIDATION
      if (request.signal?.aborted) {
        throw new McpPreEntryError("mcp_cancelled", 499);
      }

      if (
        typeof request.operationId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          request.operationId,
        )
      ) {
        throw new McpPreEntryError("invalid_operation_id", 400);
      }

      const now = Date.now();
      if (request.deadline <= now) {
        throw new McpPreEntryError("mcp_timeout", 504);
      }

      const profile: McpReviewedProfile = config.getProfile(
        request.profileId,
        request.revision,
        request.purpose,
        now,
      );

      const maxTimeout = Math.min(
        profile.timeoutMs,
        MCP_CLIENT_LIMITS.maxTimeoutMs,
      );
      const effectiveDeadline = Math.min(request.deadline, now + maxTimeout);
      if (effectiveDeadline <= now) {
        throw new McpPreEntryError("mcp_timeout", 504);
      }

      if (!(request.body instanceof Uint8Array)) {
        throw new McpPreEntryError("invalid_request_body", 400);
      }
      const bodyBytes = Buffer.from(
        request.body.buffer,
        request.body.byteOffset,
        request.body.byteLength,
      );
      if (
        bodyBytes.length > profile.maxRequestBytes ||
        bodyBytes.length > MCP_CLIENT_LIMITS.maxRequestBytes
      ) {
        throw new McpPreEntryError("mcp_request_limit", 413);
      }

      if (profile.credential === "none") {
        if (request.token) {
          throw new McpPreEntryError("unexpected_credential_token", 400);
        }
      } else {
        if (!request.token) {
          throw new McpPreEntryError("missing_credential_token", 400);
        }
        if (!request.connectionRevision) {
          throw new McpPreEntryError("missing_connection_revision", 400);
        }
      }

      const requestId = randomUUID();
      const bodyHash = createHash("sha256").update(bodyBytes).digest("hex");
      const bodyBase64 = bodyBytes.toString("base64");

      let credentialEnvelope: McpCredentialEnvelope | undefined;
      if (request.token && request.connectionRevision) {
        credentialEnvelope = config.sealToken(
          {
            version: 1,
            requestId,
            operationId: request.operationId,
            issuedAt: now,
            deadline: effectiveDeadline,
            profileId: profile.profileId,
            revision: profile.revision,
            purpose: profile.purpose,
            bodyHash,
            body: bodyBase64,
          },
          profile,
          request.connectionRevision,
          request.token,
        );
      }

      const envelope: McpEnvelope = Object.freeze({
        version: 1,
        requestId,
        operationId: request.operationId,
        issuedAt: now,
        deadline: effectiveDeadline,
        profileId: profile.profileId,
        revision: profile.revision,
        purpose: profile.purpose,
        bodyHash,
        body: bodyBase64,
        ...(credentialEnvelope ? { credential: credentialEnvelope } : {}),
      });

      const signature = config.signEnvelope(envelope);
      const payloadString = canonicalEnvelope(envelope);
      if (
        Buffer.byteLength(payloadString) > MCP_CLIENT_LIMITS.maxEnvelopeBytes
      ) {
        throw new McpPreEntryError("mcp_envelope_limit", 413);
      }

      // Check pre-entry abort one last time before initiating dispatch
      if (request.signal?.aborted) {
        throw new McpPreEntryError("mcp_cancelled", 499);
      }

      // 2. DISPATCH ENTRY (Point of no return: failures become outcome unknown)
      const controller = new AbortController();
      const onCallerAbort = () => controller.abort();
      if (request.signal) {
        request.signal.addEventListener("abort", onCallerAbort, { once: true });
      }

      const remainingMs = effectiveDeadline - Date.now();
      const timeoutTimer = setTimeout(
        () => {
          controller.abort();
        },
        Math.max(0, remainingMs),
      );

      let response: Response;
      try {
        response = await config.binding.fetch(config.brokerUrl.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-MCP-Signature": signature,
          },
          body: payloadString,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (fetchError) {
        throw new McpOutcomeUnknownError(
          "mcp_dispatch_failed",
          502,
          fetchError,
        );
      } finally {
        clearTimeout(timeoutTimer);
        if (request.signal) {
          request.signal.removeEventListener("abort", onCallerAbort);
        }
      }

      // 3. TRANSPORT REJECTION CHECKS
      if (response.status >= 300 && response.status < 400) {
        throw new McpOutcomeUnknownError("mcp_redirect_denied", 502);
      }

      if (response.status !== 200) {
        throw new McpOutcomeUnknownError(
          `mcp_broker_http_${response.status}`,
          502,
        );
      }

      // 4. BOUNDED STREAM CONSUMPTION (<= 96 KiB)
      const chunks: Uint8Array[] = [];
      let totalTransportBytes = 0;
      const reader = response.body?.getReader();

      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalTransportBytes += value.byteLength;
            if (
              totalTransportBytes > MCP_CLIENT_LIMITS.maxTransportResponseBytes
            ) {
              await reader.cancel();
              throw new McpOutcomeUnknownError("mcp_response_oversize", 502);
            }
            chunks.push(value);
          }
        } catch (streamError) {
          if (streamError instanceof McpOutcomeUnknownError) {
            throw streamError;
          }
          throw new McpOutcomeUnknownError(
            "mcp_stream_error",
            502,
            streamError,
          );
        }
      } else {
        const buf = new Uint8Array(await response.arrayBuffer());
        if (buf.byteLength > MCP_CLIENT_LIMITS.maxTransportResponseBytes) {
          throw new McpOutcomeUnknownError("mcp_response_oversize", 502);
        }
        chunks.push(buf);
        totalTransportBytes = buf.byteLength;
      }

      // 5. RESPONSE PAYLOAD PARSING & VALIDATION
      const fullTransportBuffer = Buffer.concat(chunks, totalTransportBytes);
      let parsedJson: unknown;
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(
          fullTransportBuffer,
        );
        parsedJson = JSON.parse(text);
      } catch (parseError) {
        throw new McpOutcomeUnknownError(
          "mcp_response_malformed",
          502,
          parseError,
        );
      }

      if (
        !parsedJson ||
        typeof parsedJson !== "object" ||
        Array.isArray(parsedJson)
      ) {
        throw new McpOutcomeUnknownError("mcp_response_malformed", 502);
      }

      const rootRecord = parsedJson as Record<string, unknown>;
      const keys = Object.keys(rootRecord);
      const expectedKeys = ["status", "body", "headers", "destination"];
      if (keys.length !== 4 || keys.some((k) => !expectedKeys.includes(k))) {
        throw new McpOutcomeUnknownError("mcp_response_malformed", 502);
      }

      // Validate status
      if (
        typeof rootRecord.status !== "number" ||
        !Number.isSafeInteger(rootRecord.status) ||
        rootRecord.status < 200 ||
        rootRecord.status >= 300
      ) {
        throw new McpOutcomeUnknownError("mcp_response_status_invalid", 502);
      }

      // Validate headers
      if (
        !rootRecord.headers ||
        typeof rootRecord.headers !== "object" ||
        Array.isArray(rootRecord.headers)
      ) {
        throw new McpOutcomeUnknownError("mcp_response_headers_invalid", 502);
      }
      const headerMap: Record<string, string> = {};
      for (const [hKey, hVal] of Object.entries(rootRecord.headers)) {
        const lowerKey = hKey.toLowerCase();
        if (
          !MCP_ALLOWED_RESPONSE_HEADERS.includes(
            lowerKey as (typeof MCP_ALLOWED_RESPONSE_HEADERS)[number],
          )
        ) {
          throw new McpOutcomeUnknownError("mcp_unsupported_header", 502);
        }
        if (
          typeof hVal !== "string" ||
          hVal.length === 0 ||
          hVal.length > 128 ||
          !/^[\x21-\x7e]+(?: [\x21-\x7e]+)*$/.test(hVal)
        ) {
          throw new McpOutcomeUnknownError("mcp_response_headers_invalid", 502);
        }
        headerMap[lowerKey] = hVal;
      }

      // Validate base64 body and bound decoded size
      if (typeof rootRecord.body !== "string") {
        throw new McpOutcomeUnknownError("mcp_response_body_invalid", 502);
      }
      if (
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          rootRecord.body,
        )
      ) {
        throw new McpOutcomeUnknownError("mcp_response_body_invalid", 502);
      }

      const decodedBody = Buffer.from(rootRecord.body, "base64");
      if (decodedBody.toString("base64") !== rootRecord.body) {
        throw new McpOutcomeUnknownError("mcp_response_body_invalid", 502);
      }
      if (
        decodedBody.length > profile.maxResponseBytes ||
        decodedBody.length > MCP_CLIENT_LIMITS.maxDecodedBodyBytes
      ) {
        throw new McpOutcomeUnknownError("mcp_response_body_limit", 502);
      }

      // Validate destination attestation
      if (
        !rootRecord.destination ||
        typeof rootRecord.destination !== "object" ||
        Array.isArray(rootRecord.destination)
      ) {
        throw new McpOutcomeUnknownError("mcp_destination_invalid", 502);
      }
      const destRecord = rootRecord.destination as Record<string, unknown>;
      const destKeys = Object.keys(destRecord);
      const expectedDestKeys = ["profileId", "revision", "purpose", "address"];
      if (
        destKeys.length !== 4 ||
        destKeys.some((k) => !expectedDestKeys.includes(k))
      ) {
        throw new McpOutcomeUnknownError("mcp_destination_invalid", 502);
      }

      if (
        destRecord.profileId !== envelope.profileId ||
        destRecord.revision !== envelope.revision ||
        destRecord.purpose !== envelope.purpose
      ) {
        throw new McpOutcomeUnknownError("mcp_destination_mismatch", 502);
      }

      if (
        typeof destRecord.address !== "string" ||
        !isValidIpAddress(destRecord.address)
      ) {
        throw new McpOutcomeUnknownError("mcp_destination_invalid", 502);
      }

      return Object.freeze({
        status: rootRecord.status,
        body: new Uint8Array(
          decodedBody.buffer,
          decodedBody.byteOffset,
          decodedBody.byteLength,
        ),
        headers: Object.freeze(headerMap),
        destination: Object.freeze({
          profileId: String(destRecord.profileId),
          revision: String(destRecord.revision),
          purpose: String(destRecord.purpose),
          address: String(destRecord.address),
        }),
      });
    },
  });
}
