import "server-only";
import { AppError } from "@/lib/errors";
import {
  SANDBOX_LIMITS,
  type SandboxWireCreateRequest,
  type SandboxWireCreateResponse,
  type SandboxWireStatusResponse,
  type SandboxWireTerminateResponse,
  sandboxWireCreateRequestSchema,
  sandboxWireCreateResponseSchema,
  sandboxWireStatusResponseSchema,
  sandboxWireTerminateResponseSchema,
} from "./contract";

export type SandboxWireOutcome<T> =
  | { kind: "ok"; value: T }
  /** Terminal transport evidence: the endpoint definitively rejected the call. */
  | { kind: "rejected"; status: number; body: string }
  /** Ambiguous: timeouts, connection loss, malformed or oversized responses all
   * leave remote resource existence unknown. Liability is fully retained. */
  | { kind: "ambiguous"; reason: string };

export type SandboxGatewayClient = Readonly<{
  identity: Readonly<{
    protocol: "sandbox-gateway-v1";
    baseUrl: string;
    keyIdentity: string;
  }>;
  create(
    request: SandboxWireCreateRequest,
  ): Promise<SandboxWireOutcome<SandboxWireCreateResponse>>;
  status(
    handle: string,
  ): Promise<SandboxWireOutcome<SandboxWireStatusResponse>>;
  terminate(
    handle: string,
  ): Promise<SandboxWireOutcome<SandboxWireTerminateResponse>>;
}>;

export type SandboxGatewayOptions = Readonly<{
  baseUrl: string;
  key: string;
  keyIdentity: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}>;

const safeHandle = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Bounded gateway client. Fixed paths, fixed protocol header, no redirects, a
 * hard response cap of 4 KiB, and no code or input content ever crosses the
 * wire — only digests and policy. Handles are validated before they can reach
 * a URL path, so malformed or crafted handles fail locally without a request.
 */
export function createSandboxGatewayClient(
  options: SandboxGatewayOptions,
): SandboxGatewayClient {
  const baseUrl = new URL(options.baseUrl);
  if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
    throw new AppError("sandbox_gateway_unconfigured", 503);
  }
  if (!options.key || options.key.length < 32) {
    throw new AppError("sandbox_gateway_unconfigured", 503);
  }
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;

  const request = async <T>(
    path: string,
    parse: (raw: unknown) => T,
    body?: unknown,
  ): Promise<SandboxWireOutcome<T>> => {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl.origin}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${options.key}`,
          "content-type": "application/json",
          "x-sandbox-protocol": "sandbox-gateway-v1",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return {
        kind: "ambiguous",
        reason: error instanceof Error ? error.name : "transport_error",
      };
    }
    if (response.status < 200 || response.status > 299) {
      // Only a complete, bounded body is terminal evidence; anything else is ambiguous.
      try {
        const text = await cappedText(response, SANDBOX_LIMITS.wireResultBytes);
        if (text === null)
          return { kind: "ambiguous", reason: "wire_response_oversized" };
        return { kind: "rejected", status: response.status, body: text };
      } catch {
        return { kind: "ambiguous", reason: "transport_error" };
      }
    }
    const text = await cappedText(
      response,
      SANDBOX_LIMITS.wireResultBytes,
    ).catch(() => null);
    if (text === null)
      return { kind: "ambiguous", reason: "wire_response_oversized" };
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { kind: "ambiguous", reason: "wire_response_malformed" };
    }
    try {
      return { kind: "ok", value: parse(raw) };
    } catch {
      return { kind: "ambiguous", reason: "wire_response_malformed" };
    }
  };

  return Object.freeze({
    identity: Object.freeze({
      protocol: "sandbox-gateway-v1" as const,
      baseUrl: baseUrl.origin,
      keyIdentity: options.keyIdentity,
    }),
    async create(wireRequest) {
      const parsed = sandboxWireCreateRequestSchema.safeParse(wireRequest);
      if (!parsed.success)
        return { kind: "ambiguous", reason: "wire_request_invalid" };
      const outcome = await request(
        "/v1/sandboxes",
        sandboxWireCreateResponseSchema.parse,
        parsed.data,
      );
      if (
        outcome.kind === "ok" &&
        outcome.value.idempotencyKey !== parsed.data.idempotencyKey
      ) {
        return { kind: "ambiguous", reason: "wire_response_malformed" };
      }
      return outcome;
    },
    async status(handle) {
      if (!safeHandle.test(handle))
        return { kind: "ambiguous", reason: "wire_handle_invalid" };
      return request(
        `/v1/sandboxes/${handle}/status`,
        sandboxWireStatusResponseSchema.parse,
      );
    },
    async terminate(handle) {
      if (!safeHandle.test(handle))
        return { kind: "ambiguous", reason: "wire_handle_invalid" };
      return request(
        `/v1/sandboxes/${handle}/terminate`,
        sandboxWireTerminateResponseSchema.parse,
        {},
      );
    },
  });
}

/** Reads at most `cap` bytes and reports overflow instead of trusting the body. */
async function cappedText(
  response: Response,
  cap: number,
): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > cap) return null;
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
