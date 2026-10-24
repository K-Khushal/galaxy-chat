import "server-only";
import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import {
  SANDBOX_LIMITS,
  type SandboxWireCreateRequest,
  type SandboxWireCreateResponse,
  type SandboxWireLookupResponse,
  type SandboxWireStatusResponse,
  type SandboxWireTerminateResponse,
  sandboxWireCreateRequestSchema,
  sandboxWireCreateResponseSchema,
  sandboxWireLookupResponseSchema,
  sandboxWireStatusResponseSchema,
  sandboxWireTerminateResponseSchema,
} from "./contract";

export type SandboxWireOutcome<T> =
  | { kind: "ok"; value: T }
  /** HTTP failure only; it proves neither absence of a resource nor zero cost. */
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
    deadline?: number,
  ): Promise<SandboxWireOutcome<SandboxWireCreateResponse>>;
  lookup(
    operationId: string,
    bindingDigest: string,
  ): Promise<SandboxWireOutcome<SandboxWireLookupResponse>>;
  status(
    handle: string,
    deadline?: number,
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

const clients = new WeakMap<SandboxGatewayClient, { keyDigest: string }>();
function offlineOnly() {
  if (process.env.NODE_ENV !== "test")
    throw new AppError("sandbox_adapter_offline_only", 503);
}
export function assertSandboxGateway(
  client: SandboxGatewayClient,
  expected: {
    baseUrl: string;
    keyIdentity: string;
    key: string;
  },
) {
  offlineOnly();
  const issued = clients.get(client);
  if (
    !issued ||
    client.identity.baseUrl !== expected.baseUrl ||
    client.identity.keyIdentity !== expected.keyIdentity ||
    issued.keyDigest !== createHash("sha256").update(expected.key).digest("hex")
  )
    throw new AppError("sandbox_gateway_changed", 503);
}
export function assertSandboxOperationGateway(
  client: SandboxGatewayClient,
  expected: SandboxGatewayClient["identity"],
) {
  offlineOnly();
  const issued = clients.get(client);
  if (
    !issued ||
    expected.protocol !== "sandbox-gateway-v1" ||
    expected.baseUrl !== client.identity.baseUrl ||
    expected.keyIdentity !== client.identity.keyIdentity ||
    issued.keyDigest !== expected.keyIdentity
  )
    throw new AppError("sandbox_gateway_changed", 503);
}
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
  offlineOnly();
  if (!URL.canParse(options.baseUrl))
    throw new AppError("sandbox_gateway_unconfigured", 503);
  const baseUrl = new URL(options.baseUrl);
  if (
    baseUrl.protocol !== "http:" ||
    baseUrl.hostname !== "127.0.0.1" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash ||
    !/^[a-f0-9]{64}$/.test(options.keyIdentity)
  ) {
    throw new AppError("sandbox_gateway_unconfigured", 503);
  }
  if (
    !options.key ||
    options.key.length < 32 ||
    options.keyIdentity !==
      createHash("sha256").update(options.key).digest("hex")
  ) {
    throw new AppError("sandbox_gateway_unconfigured", 503);
  }
  const doFetch = options.fetchImpl ?? fetch;
  const key = options.key;
  const keyIdentity = options.keyIdentity;
  const timeoutMs = Math.min(5_000, Math.max(1, options.timeoutMs ?? 5_000));

  const request = async <T>(
    path: string,
    parse: (raw: unknown) => T,
    body?: unknown,
    deadline?: number,
  ): Promise<SandboxWireOutcome<T>> => {
    offlineOnly();
    const remaining = Math.min(
      timeoutMs,
      (deadline ?? Date.now() + timeoutMs) - Date.now(),
    );
    if (remaining <= 0)
      return { kind: "ambiguous", reason: "deadline_expired" };
    const signal = AbortSignal.timeout(remaining);
    let response: Response;
    try {
      response = await doFetch(`${baseUrl.origin}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "x-sandbox-protocol": "sandbox-gateway-v1",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal,
      });
    } catch (error) {
      return {
        kind: "ambiguous",
        reason: error instanceof Error ? error.name : "transport_error",
      };
    }
    if (response.status < 200 || response.status > 299) {
      // A bounded HTTP error is still ambiguous after durable entry.
      try {
        const text = await cappedText(
          response,
          SANDBOX_LIMITS.wireResultBytes,
          signal,
        );
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
      signal,
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

  const client: SandboxGatewayClient = Object.freeze({
    identity: Object.freeze({
      protocol: "sandbox-gateway-v1" as const,
      baseUrl: baseUrl.origin,
      keyIdentity,
    }),
    async create(wireRequest, deadline) {
      offlineOnly();
      const parsed = sandboxWireCreateRequestSchema.safeParse(wireRequest);
      if (!parsed.success)
        return { kind: "ambiguous", reason: "wire_request_invalid" };
      const outcome = await request(
        "/v1/sandboxes",
        sandboxWireCreateResponseSchema.parse,
        parsed.data,
        deadline,
      );
      if (
        outcome.kind === "ok" &&
        outcome.value.idempotencyKey !== parsed.data.idempotencyKey
      ) {
        return { kind: "ambiguous", reason: "wire_response_malformed" };
      }
      return outcome;
    },
    async lookup(operationId, bindingDigest) {
      offlineOnly();
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          operationId,
        ) ||
        !/^[a-f0-9]{64}$/.test(bindingDigest)
      )
        return { kind: "ambiguous", reason: "wire_lookup_invalid" };
      const outcome = await request(
        `/v1/operations/${operationId}`,
        sandboxWireLookupResponseSchema.parse,
        { bindingDigest },
      );
      if (
        outcome.kind === "ok" &&
        (outcome.value.operationId !== operationId ||
          outcome.value.bindingDigest !== bindingDigest)
      )
        return { kind: "ambiguous", reason: "wire_lookup_mismatch" };
      return outcome;
    },
    async status(handle, deadline) {
      offlineOnly();
      if (!safeHandle.test(handle))
        return { kind: "ambiguous", reason: "wire_handle_invalid" };
      return request(
        `/v1/sandboxes/${handle}/status`,
        sandboxWireStatusResponseSchema.parse,
        undefined,
        deadline,
      );
    },
    async terminate(handle) {
      offlineOnly();
      if (!safeHandle.test(handle))
        return { kind: "ambiguous", reason: "wire_handle_invalid" };
      return request(
        `/v1/sandboxes/${handle}/terminate`,
        sandboxWireTerminateResponseSchema.parse,
        {},
      );
    },
  });
  clients.set(client, {
    keyDigest: createHash("sha256").update(key).digest("hex"),
  });
  return client;
}

/** Reads at most `cap` bytes and reports overflow instead of trusting the body. */
async function cappedText(
  response: Response,
  cap: number,
  signal: AbortSignal,
): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > cap) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
