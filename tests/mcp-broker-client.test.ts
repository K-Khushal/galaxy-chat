import { beforeAll, describe, expect, it, mock } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

mock.module("server-only", () => ({}));

import type { McpBrokerClient } from "@/lib/mcp/broker-client";
import type { McpClientConfig, McpReviewedProfile } from "@/lib/mcp/config";
import type { McpOutcomeUnknownError as McpOutcomeUnknownErrorType } from "@/lib/mcp/contract";
import {
  authenticate,
  canonical as brokerCanonical,
  openCredential,
  parseEnvelope,
} from "../services/mcp-egress/src/protocol";

let createMcpBrokerClient: typeof import("@/lib/mcp/broker-client").createMcpBrokerClient;
let resolveMcpClientConfig: typeof import("@/lib/mcp/config").resolveMcpClientConfig;
let MCP_CLIENT_LIMITS: typeof import("@/lib/mcp/contract").MCP_CLIENT_LIMITS;
let McpOutcomeUnknownError: typeof import("@/lib/mcp/contract").McpOutcomeUnknownError;
let McpPreEntryError: typeof import("@/lib/mcp/contract").McpPreEntryError;
let canonicalEnvelope: typeof import("@/lib/mcp/contract").canonicalEnvelope;

beforeAll(async () => {
  const brokerClientMod = await import("@/lib/mcp/broker-client");
  const configMod = await import("@/lib/mcp/config");
  const contractMod = await import("@/lib/mcp/contract");

  createMcpBrokerClient = brokerClientMod.createMcpBrokerClient;
  resolveMcpClientConfig = configMod.resolveMcpClientConfig;
  MCP_CLIENT_LIMITS = contractMod.MCP_CLIENT_LIMITS;
  McpOutcomeUnknownError = contractMod.McpOutcomeUnknownError;
  McpPreEntryError = contractMod.McpPreEntryError;
  canonicalEnvelope = contractMod.canonicalEnvelope;
});

function makeStream(chunks: Uint8Array[], onCancel?: () => void) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        const chunk = chunks[index];
        index++;
        if (chunk) {
          controller.enqueue(chunk);
        }
      } else {
        controller.close();
      }
    },
    cancel() {
      if (onCancel) {
        onCancel();
      }
    },
  });
}

describe("Child 34 MCP wire client", () => {
  const hmacKeyBytes = randomBytes(32);
  const envelopeKeyBytes = randomBytes(32);
  const testHmacKey = hmacKeyBytes.toString("base64");
  const testEnvelopeKey = envelopeKeyBytes.toString("base64");
  const validExpiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const expiredAt = new Date(Date.now() - 86_400_000).toISOString();

  const testProfiles: readonly McpReviewedProfile[] = [
    {
      profileId: "profile-call",
      revision: "rev-1",
      purpose: "mcp.call",
      resource: "https://api.example.com/mcp",
      issuer: "https://auth.example.com/",
      credential: "bearer",
      maxRequestBytes: 1024,
      maxResponseBytes: 2048,
      timeoutMs: 5000,
      expiresAt: validExpiresAt,
    },
    {
      profileId: "profile-list",
      revision: "rev-1",
      purpose: "mcp.list",
      resource: "https://api.example.com/mcp",
      issuer: "https://auth.example.com/",
      credential: "none",
      maxRequestBytes: 512,
      maxResponseBytes: 1024,
      timeoutMs: 3000,
      expiresAt: validExpiresAt,
    },
    {
      profileId: "profile-large",
      revision: "rev-1",
      purpose: "mcp.call",
      resource: "https://api.example.com/mcp",
      issuer: "https://auth.example.com/",
      credential: "none",
      maxRequestBytes: 65_536,
      maxResponseBytes: 64 * 1024,
      timeoutMs: 10_000,
      expiresAt: validExpiresAt,
    },
    {
      profileId: "profile-expired",
      revision: "rev-1",
      purpose: "mcp.call",
      resource: "https://api.example.com/mcp",
      issuer: "https://auth.example.com/",
      credential: "none",
      maxRequestBytes: 512,
      maxResponseBytes: 1024,
      timeoutMs: 3000,
      expiresAt: expiredAt,
    },
  ];

  const brokerProfileForCall = {
    profileId: "profile-call",
    revision: "rev-1",
    purpose: "mcp.call" as const,
    endpoint: "https://api.example.com/mcp",
    hostname: "api.example.com",
    port: 443,
    path: "/mcp",
    method: "POST" as const,
    contentType: "application/json" as const,
    responseTypes: ["application/json"],
    maxRequestBytes: 1024,
    maxResponseBytes: 2048,
    timeoutMs: 5000,
    connectMs: 2000,
    firstByteMs: 3000,
    resource: "https://api.example.com/mcp",
    issuer: "https://auth.example.com/",
    credential: "bearer" as const,
    formFields: {},
  };

  const baseEnv: Record<string, string> = {
    MCP_CLIENT_ENABLED: "1",
    MCP_CLIENT_BROKER_URL: "https://broker.example.com/v1/egress",
    MCP_CLIENT_HMAC_KEY: testHmacKey,
    MCP_CLIENT_ENVELOPE_KEY: testEnvelopeKey,
    MCP_CLIENT_PROFILES_JSON: JSON.stringify(testProfiles),
  };

  it("fails closed when MCP_CLIENT_ENABLED is not 1 or missing", () => {
    const disabledConfig = resolveMcpClientConfig({
      env: { ...baseEnv, MCP_CLIENT_ENABLED: "0" },
      binding: { fetch: async () => new Response() },
    });
    expect(disabledConfig).toBeUndefined();

    const missingConfig = resolveMcpClientConfig({
      env: { ...baseEnv, MCP_CLIENT_ENABLED: "" },
      binding: { fetch: async () => new Response() },
    });
    expect(missingConfig).toBeUndefined();
  });

  it("fails closed with McpPreEntryError when binding is missing", () => {
    expect(() =>
      resolveMcpClientConfig({
        env: baseEnv,
        binding: undefined,
      }),
    ).toThrow(McpPreEntryError);
  });

  it("fails closed when HMAC key and envelope key are identical", () => {
    expect(() =>
      resolveMcpClientConfig({
        env: {
          ...baseEnv,
          MCP_CLIENT_ENVELOPE_KEY: testHmacKey,
        },
        binding: { fetch: async () => new Response() },
      }),
    ).toThrow(McpPreEntryError);
  });

  it("fails closed on invalid broker URLs (non-https, query, port, IP literals)", () => {
    const invalidUrls = [
      "http://broker.example.com/v1/egress",
      "https://broker.example.com/v1/egress?foo=bar",
      "https://broker.example.com:8443/v1/egress",
      "https://192.0.2.1/v1/egress",
      "https://broker.example.com/wrong-path",
      "https://broker.example.com/",
    ];

    for (const brokerUrl of invalidUrls) {
      expect(() =>
        resolveMcpClientConfig({
          env: { ...baseEnv, MCP_CLIENT_BROKER_URL: brokerUrl },
          binding: { fetch: async () => new Response() },
        }),
      ).toThrow(McpPreEntryError);
    }
  });

  it("dispatches envelope that satisfies broker oracle parseEnvelope, authenticate, and openCredential", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";
    let capturedRedirect = "";

    const mockBinding = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedMethod = init?.method ?? "";
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        capturedBody = String(init?.body ?? "");
        capturedRedirect = init?.redirect ?? "";

        const mockResponse = {
          status: 200,
          body: Buffer.from("test mcp response payload").toString("base64"),
          headers: {
            "content-type": "application/json",
            "mcp-session-id": "session-xyz",
          },
          destination: {
            profileId: "profile-call",
            revision: "rev-1",
            purpose: "mcp.call",
            address: "192.0.2.45",
          },
        };

        return new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    };

    const config = resolveMcpClientConfig({
      env: baseEnv,
      binding: mockBinding,
    });
    if (!config) throw new Error("Config expected");

    const client: McpBrokerClient = createMcpBrokerClient(config);
    const operationId = randomUUID();
    const token = "secret-caller-token-123";
    const bodyBytes = new TextEncoder().encode(
      JSON.stringify({ jsonrpc: "2.0", method: "tools/call" }),
    );

    const result = await client.dispatch({
      operationId,
      profileId: "profile-call",
      revision: "rev-1",
      purpose: "mcp.call",
      body: bodyBytes,
      deadline: Date.now() + 5000,
      token,
      connectionRevision: "conn-rev-1",
    });

    // 1. Validate transport request
    expect(capturedUrl).toBe("https://broker.example.com/v1/egress");
    expect(capturedMethod).toBe("POST");
    expect(capturedRedirect).toBe("manual");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
    const signature = capturedHeaders["X-MCP-Signature"];
    expect(typeof signature).toBe("string");
    expect(signature.length).toBe(64);

    // 2. Pass intercepted payload to broker protocol oracle
    const now = Date.now();
    const parsedJson = JSON.parse(capturedBody);
    const brokerParsed = parseEnvelope(parsedJson, now);

    expect(brokerParsed.operationId).toBe(operationId);
    expect(brokerParsed.profileId).toBe("profile-call");
    expect(brokerParsed.revision).toBe("rev-1");
    expect(brokerParsed.purpose).toBe("mcp.call");

    // 3. Oracle authentication check
    expect(() =>
      authenticate(brokerParsed, signature, hmacKeyBytes),
    ).not.toThrow();

    // 4. Oracle credential decryption check
    const recoveredToken = openCredential(
      brokerParsed,
      brokerProfileForCall,
      envelopeKeyBytes,
    );
    expect(recoveredToken).toBe(token);

    // 5. Canonical formatting parity with broker
    expect(canonicalEnvelope(brokerParsed)).toBe(brokerCanonical(brokerParsed));

    // 6. Signature tamper check: broker authenticate throws
    const flippedChar = signature[0] === "a" ? "b" : "a";
    const tamperedSignature = `${flippedChar}${signature.slice(1)}`;
    expect(() =>
      authenticate(brokerParsed, tamperedSignature, hmacKeyBytes),
    ).toThrow();

    // 7. BodyHash tamper check: broker parseEnvelope throws
    const tamperedBodyHashJson = {
      ...parsedJson,
      bodyHash: "0".repeat(64),
    };
    expect(() => parseEnvelope(tamperedBodyHashJson, now)).toThrow();

    // 8. Result inspection
    expect(result.status).toBe(200);
    expect(new TextDecoder().decode(result.body)).toBe(
      "test mcp response payload",
    );
    expect(result.headers["content-type"]).toBe("application/json");
    expect(result.headers["mcp-session-id"]).toBe("session-xyz");
    expect(result.destination.address).toBe("192.0.2.45");
  });

  it("verifies AAD tamper fails closed in broker openCredential", async () => {
    let capturedBody = "";
    const mockBinding = {
      fetch: async (_: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = String(init?.body ?? "");
        const mockResponse = {
          status: 200,
          body: Buffer.from("ok").toString("base64"),
          headers: { "content-type": "application/json" },
          destination: {
            profileId: "profile-call",
            revision: "rev-1",
            purpose: "mcp.call",
            address: "192.0.2.1",
          },
        };
        return new Response(JSON.stringify(mockResponse));
      },
    };

    const config = resolveMcpClientConfig({
      env: baseEnv,
      binding: mockBinding,
    });
    if (!config) throw new Error("Config expected");

    const client = createMcpBrokerClient(config);
    await client.dispatch({
      operationId: randomUUID(),
      profileId: "profile-call",
      revision: "rev-1",
      purpose: "mcp.call",
      body: new Uint8Array([1, 2, 3]),
      deadline: Date.now() + 5000,
      token: "secret-token-xyz",
      connectionRevision: "conn-rev-1",
    });

    const parsedJson = JSON.parse(capturedBody);
    const brokerParsed = parseEnvelope(parsedJson, Date.now());

    // Tamper requestId
    expect(() =>
      openCredential(
        { ...brokerParsed, requestId: randomUUID() },
        brokerProfileForCall,
        envelopeKeyBytes,
      ),
    ).toThrow();

    // Tamper operationId
    expect(() =>
      openCredential(
        { ...brokerParsed, operationId: randomUUID() },
        brokerProfileForCall,
        envelopeKeyBytes,
      ),
    ).toThrow();

    // Tamper resource
    expect(() =>
      openCredential(
        brokerParsed,
        { ...brokerProfileForCall, resource: "https://evil.example.com" },
        envelopeKeyBytes,
      ),
    ).toThrow();

    // Tamper issuer
    expect(() =>
      openCredential(
        brokerParsed,
        { ...brokerProfileForCall, issuer: "https://evil.example.com" },
        envelopeKeyBytes,
      ),
    ).toThrow();

    // Tamper ciphertext
    if (brokerParsed.credential) {
      const corruptedCred = {
        ...brokerParsed.credential,
        ciphertext: Buffer.from("tampered").toString("base64"),
      };
      expect(() =>
        openCredential(
          { ...brokerParsed, credential: corruptedCred },
          brokerProfileForCall,
          envelopeKeyBytes,
        ),
      ).toThrow();
    }
  });

  it("enforces pre-entry failures without dispatching any network fetch", async () => {
    let fetchCount = 0;
    const mockBinding = {
      fetch: async () => {
        fetchCount++;
        return new Response();
      },
    };

    const config = resolveMcpClientConfig({
      env: baseEnv,
      binding: mockBinding,
    });
    if (!config) throw new Error("Config expected");

    const client = createMcpBrokerClient(config);

    // 1. Caller aborted before dispatch
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-call",
        revision: "rev-1",
        purpose: "mcp.call",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
        token: "tok",
        connectionRevision: "c1",
        signal: preAborted.signal,
      }),
    ).rejects.toThrow(McpPreEntryError);
    expect(fetchCount).toBe(0);

    // 2. Expired deadline
    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-call",
        revision: "rev-1",
        purpose: "mcp.call",
        body: new Uint8Array([1]),
        deadline: Date.now() - 100,
        token: "tok",
        connectionRevision: "c1",
      }),
    ).rejects.toThrow(McpPreEntryError);
    expect(fetchCount).toBe(0);

    // 3. Expired profile
    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-expired",
        revision: "rev-1",
        purpose: "mcp.call",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpPreEntryError);
    expect(fetchCount).toBe(0);

    // 4. Non-existent profile
    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "unknown-profile",
        revision: "rev-1",
        purpose: "mcp.call",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpPreEntryError);
    expect(fetchCount).toBe(0);

    // 5. Invalid operationId
    await expect(
      client.dispatch({
        operationId: "not-a-uuid",
        profileId: "profile-call",
        revision: "rev-1",
        purpose: "mcp.call",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
        token: "tok",
        connectionRevision: "c1",
      }),
    ).rejects.toThrow(McpPreEntryError);
    expect(fetchCount).toBe(0);

    // 6. Request body exceeding profile maxRequestBytes (profile-call max is 1024)
    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-call",
        revision: "rev-1",
        purpose: "mcp.call",
        body: new Uint8Array(1025),
        deadline: Date.now() + 5000,
        token: "tok",
        connectionRevision: "c1",
      }),
    ).rejects.toThrow(McpPreEntryError);
    expect(fetchCount).toBe(0);

    // 7. Missing token when profile requires credential
    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-call",
        revision: "rev-1",
        purpose: "mcp.call",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpPreEntryError);
    expect(fetchCount).toBe(0);

    // 8. Unexpected token when profile specifies credential: "none"
    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
        token: "unexpected-token",
        connectionRevision: "c1",
      }),
    ).rejects.toThrow(McpPreEntryError);
    expect(fetchCount).toBe(0);
  });

  it("treats post-dispatch failures as McpOutcomeUnknownError (retaining capacity/holds)", async () => {
    // 1. In-flight abort
    let inFlightAbortSignal: AbortSignal | undefined;
    const clientWithSlowFetch = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async (_: RequestInfo | URL, init?: RequestInit) => {
            inFlightAbortSignal = init?.signal ?? undefined;
            return new Promise((_, reject) => {
              if (inFlightAbortSignal) {
                inFlightAbortSignal.addEventListener("abort", () => {
                  reject(new Error("in-flight aborted"));
                });
              }
            });
          },
        },
      }) as McpClientConfig,
    );

    const callerController = new AbortController();
    const pendingDispatch = clientWithSlowFetch.dispatch({
      operationId: randomUUID(),
      profileId: "profile-list",
      revision: "rev-1",
      purpose: "mcp.list",
      body: new Uint8Array([1, 2]),
      deadline: Date.now() + 5000,
      signal: callerController.signal,
    });

    // Abort after dispatch entered fetch
    callerController.abort();
    let errOutcome: unknown;
    try {
      await pendingDispatch;
    } catch (err) {
      errOutcome = err;
    }
    expect(errOutcome instanceof McpOutcomeUnknownError).toBe(true);
    const typedUnknown = errOutcome as McpOutcomeUnknownErrorType;
    expect(typedUnknown.isOutcomeUnknown).toBe(true);
    expect(typedUnknown.isPreEntry).toBe(false);

    // 2. Broker HTTP 500
    const client500 = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () => new Response("Internal error", { status: 500 }),
        },
      }) as McpClientConfig,
    );

    await expect(
      client500.dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);

    // 3. Broker 302 redirect (must fail closed rather than auto-following)
    const client302 = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () =>
            new Response(null, {
              status: 302,
              headers: { Location: "https://evil.example.com" },
            }),
        },
      }) as McpClientConfig,
    );

    await expect(
      client302.dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);
  });

  it("strictly enforces 96 KiB transport limit and cancels stream", async () => {
    let streamCanceled = false;
    const validJsonObj = {
      status: 200,
      body: Buffer.from("hello").toString("base64"),
      headers: { "content-type": "application/json" },
      destination: {
        profileId: "profile-large",
        revision: "rev-1",
        purpose: "mcp.call",
        address: "192.0.2.10",
      },
    };
    const jsonStr = JSON.stringify(validJsonObj);

    // Case 1: Exact 96 KiB transport response (98,304 bytes)
    const exactPadding = " ".repeat(
      MCP_CLIENT_LIMITS.maxTransportResponseBytes - jsonStr.length,
    );
    const exactPayload = new TextEncoder().encode(jsonStr + exactPadding);
    expect(exactPayload.byteLength).toBe(
      MCP_CLIENT_LIMITS.maxTransportResponseBytes,
    );

    const clientExact = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () =>
            new Response(makeStream([exactPayload]), { status: 200 }),
        },
      }) as McpClientConfig,
    );

    const exactResult = await clientExact.dispatch({
      operationId: randomUUID(),
      profileId: "profile-large",
      revision: "rev-1",
      purpose: "mcp.call",
      body: new Uint8Array([1]),
      deadline: Date.now() + 5000,
    });
    expect(exactResult.status).toBe(200);

    // Case 2: 96 KiB + 1 byte triggers cancellation and McpOutcomeUnknownError
    const oversizePadding = " ".repeat(
      MCP_CLIENT_LIMITS.maxTransportResponseBytes - jsonStr.length + 1,
    );
    const oversizePayload = new TextEncoder().encode(jsonStr + oversizePadding);
    expect(oversizePayload.byteLength).toBe(
      MCP_CLIENT_LIMITS.maxTransportResponseBytes + 1,
    );
    const half = Math.floor(oversizePayload.byteLength / 2);
    const chunk1 = oversizePayload.subarray(0, half);
    const chunk2 = oversizePayload.subarray(half);
    // Continuing chunk representing additional data that should be aborted by cancellation
    const pendingChunk = new Uint8Array(1024);

    const clientOversize = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () =>
            new Response(
              makeStream([chunk1, chunk2, pendingChunk], () => {
                streamCanceled = true;
              }),
              { status: 200 },
            ),
        },
      }) as McpClientConfig,
    );

    await expect(
      clientOversize.dispatch({
        operationId: randomUUID(),
        profileId: "profile-large",
        revision: "rev-1",
        purpose: "mcp.call",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);

    expect(streamCanceled).toBe(true);
  });

  it("strictly enforces 64 KiB decoded response body limit", async () => {
    // 1. Exact 64 KiB decoded body succeeds
    const exact64kBytes = Buffer.alloc(
      MCP_CLIENT_LIMITS.maxDecodedBodyBytes,
      0x41,
    );
    const client64k = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () =>
            new Response(
              JSON.stringify({
                status: 200,
                body: exact64kBytes.toString("base64"),
                headers: { "content-type": "application/json" },
                destination: {
                  profileId: "profile-large",
                  revision: "rev-1",
                  purpose: "mcp.call",
                  address: "192.0.2.1",
                },
              }),
              { status: 200 },
            ),
        },
      }) as McpClientConfig,
    );

    const res64k = await client64k.dispatch({
      operationId: randomUUID(),
      profileId: "profile-large",
      revision: "rev-1",
      purpose: "mcp.call",
      body: new Uint8Array([1]),
      deadline: Date.now() + 5000,
    });
    expect(res64k.body.byteLength).toBe(MCP_CLIENT_LIMITS.maxDecodedBodyBytes);

    // 2. 64 KiB + 1 byte decoded body throws McpOutcomeUnknownError
    const oversizeBytes = Buffer.alloc(
      MCP_CLIENT_LIMITS.maxDecodedBodyBytes + 1,
      0x41,
    );
    const clientOversizeBody = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () =>
            new Response(
              JSON.stringify({
                status: 200,
                body: oversizeBytes.toString("base64"),
                headers: { "content-type": "application/json" },
                destination: {
                  profileId: "profile-large",
                  revision: "rev-1",
                  purpose: "mcp.call",
                  address: "192.0.2.1",
                },
              }),
              { status: 200 },
            ),
        },
      }) as McpClientConfig,
    );

    await expect(
      clientOversizeBody.dispatch({
        operationId: randomUUID(),
        profileId: "profile-large",
        revision: "rev-1",
        purpose: "mcp.call",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);
  });

  it("validates response headers allowlist and rejects unapproved headers", async () => {
    // 1. Rejected header (e.g. Set-Cookie)
    const clientDisallowedHeader = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () =>
            new Response(
              JSON.stringify({
                status: 200,
                body: Buffer.from("ok").toString("base64"),
                headers: {
                  "content-type": "application/json",
                  "set-cookie": "session=malicious",
                },
                destination: {
                  profileId: "profile-list",
                  revision: "rev-1",
                  purpose: "mcp.list",
                  address: "192.0.2.1",
                },
              }),
            ),
        },
      }) as McpClientConfig,
    );

    await expect(
      clientDisallowedHeader.dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);

    // 2. Allowed headers: content-type, mcp-session-id, mcp-protocol-version
    const clientAllowedHeaders = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () =>
            new Response(
              JSON.stringify({
                status: 200,
                body: Buffer.from("ok").toString("base64"),
                headers: {
                  "Content-Type": "application/json",
                  "MCP-Session-Id": "sess-42",
                  "MCP-Protocol-Version": "2024-11-05",
                },
                destination: {
                  profileId: "profile-list",
                  revision: "rev-1",
                  purpose: "mcp.list",
                  address: "192.0.2.1",
                },
              }),
            ),
        },
      }) as McpClientConfig,
    );

    const allowedRes = await clientAllowedHeaders.dispatch({
      operationId: randomUUID(),
      profileId: "profile-list",
      revision: "rev-1",
      purpose: "mcp.list",
      body: new Uint8Array([1]),
      deadline: Date.now() + 5000,
    });
    expect(allowedRes.headers["content-type"]).toBe("application/json");
    expect(allowedRes.headers["mcp-session-id"]).toBe("sess-42");
    expect(allowedRes.headers["mcp-protocol-version"]).toBe("2024-11-05");
  });

  it("validates destination attestation and rejects destination mismatches", async () => {
    const makeClientWithDest = (destination: Record<string, unknown>) =>
      createMcpBrokerClient(
        resolveMcpClientConfig({
          env: baseEnv,
          binding: {
            fetch: async () =>
              new Response(
                JSON.stringify({
                  status: 200,
                  body: Buffer.from("ok").toString("base64"),
                  headers: { "content-type": "application/json" },
                  destination,
                }),
              ),
          },
        }) as McpClientConfig,
      );

    const baseDest = {
      profileId: "profile-list",
      revision: "rev-1",
      purpose: "mcp.list",
      address: "192.0.2.1",
    };

    // Mismatched profileId
    await expect(
      makeClientWithDest({
        ...baseDest,
        profileId: "different-profile",
      }).dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);

    // Mismatched revision
    await expect(
      makeClientWithDest({ ...baseDest, revision: "rev-2" }).dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);

    // Mismatched purpose
    await expect(
      makeClientWithDest({ ...baseDest, purpose: "mcp.call" }).dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);

    // Invalid IP address (DNS name or ill-formed string)
    await expect(
      makeClientWithDest({
        ...baseDest,
        address: "not-an-ip.example.com",
      }).dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);

    // Malformed IPv6 addresses (unknown postentry, never treat malformed attestation as verified)
    const malformedIpv6Addresses = [
      "1:2",
      "1:2:3:4:5:6:7",
      "1:2:3:4:5:6:7:8:9",
      "fe80::1%eth0",
      "::g",
      "2001:db8:::1",
      "999.999.999.999",
      "192.168.1.01",
    ];
    for (const badIp of malformedIpv6Addresses) {
      await expect(
        makeClientWithDest({
          ...baseDest,
          address: badIp,
        }).dispatch({
          operationId: randomUUID(),
          profileId: "profile-list",
          revision: "rev-1",
          purpose: "mcp.list",
          body: new Uint8Array([1]),
          deadline: Date.now() + 5000,
        }),
      ).rejects.toThrow(McpOutcomeUnknownError);
    }

    // Valid IPv6 destination succeeds
    const ipv6Res = await makeClientWithDest({
      ...baseDest,
      address: "2001:db8::1",
    }).dispatch({
      operationId: randomUUID(),
      profileId: "profile-list",
      revision: "rev-1",
      purpose: "mcp.list",
      body: new Uint8Array([1]),
      deadline: Date.now() + 5000,
    });
    expect(ipv6Res.destination.address).toBe("2001:db8::1");
  });

  it("never retries dispatches (strictly 1 fetch call per dispatch)", async () => {
    let callCount = 0;
    const client = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () => {
            callCount++;
            return new Response("Broker Busy", { status: 503 });
          },
        },
      }) as McpClientConfig,
    );

    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);

    expect(callCount).toBe(1);
  });

  it("redacts cryptographic secrets from config inspection and serialized objects", () => {
    const config = resolveMcpClientConfig({
      env: baseEnv,
      binding: { fetch: async () => new Response() },
    });
    if (!config) throw new Error("Config expected");

    const str = config.toString();
    expect(str).toBe("[McpClientConfig: active]");
    expect(str).not.toContain(testHmacKey);
    expect(str).not.toContain(testEnvelopeKey);

    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain(testHmacKey);
    expect(serialized).not.toContain(testEnvelopeKey);
  });

  it("prevents consumer mutation of reviewed configuration Map and enforces reviewed policy", () => {
    const config = resolveMcpClientConfig({
      env: baseEnv,
      binding: { fetch: async () => new Response() },
    });
    if (!config) throw new Error("Config expected");

    // 1. Assert profiles is read-only Map without mutation methods
    const profiles = config.profiles as unknown as Record<string, unknown>;
    expect(profiles.set).toBeUndefined();
    expect(profiles.delete).toBeUndefined();
    expect(profiles.clear).toBeUndefined();

    // 2. Assert attempting to add or modify properties fails on frozen object
    expect(() => {
      profiles.set = () => {};
    }).toThrow();

    // 3. Assert looking up existing profile returns a frozen snapshot
    const existing = config.profiles.get("profile-call::rev-1::mcp.call");
    expect(existing).toBeDefined();
    if (existing) {
      expect(() => {
        (existing as unknown as Record<string, unknown>).maxRequestBytes =
          999999;
      }).toThrow();
    }

    // 4. Assert getProfile cannot be bypassed or tampered with
    const directProfile = config.getProfile(
      "profile-call",
      "rev-1",
      "mcp.call",
    );
    expect(directProfile.maxRequestBytes).toBe(1024);
  });

  it("maintains pure transport isolation without chat, agent, or database imports", () => {
    const files = [
      "lib/mcp/contract.ts",
      "lib/mcp/config.ts",
      "lib/mcp/broker-client.ts",
    ];

    const forbiddenPatterns = [
      "@/lib/db",
      "@/lib/tools",
      "@/lib/chat",
      "@/app",
      "drizzle-orm",
      "postgres",
      'from "ai"',
      "from 'ai'",
      "@ai-sdk",
    ];

    for (const relativePath of files) {
      const fullPath = join(process.cwd(), relativePath);
      const content = readFileSync(fullPath, "utf-8");
      for (const pattern of forbiddenPatterns) {
        expect(content).not.toContain(pattern);
      }
    }
  });

  it("enforces safe integer positive deadline and rejects NaN, fractional, or negative values without dispatch", async () => {
    let fetchCount = 0;
    const config = resolveMcpClientConfig({
      env: baseEnv,
      binding: {
        fetch: async () => {
          fetchCount++;
          return new Response();
        },
      },
    });
    if (!config) throw new Error("Config expected");
    const client = createMcpBrokerClient(config);

    const invalidDeadlines = [NaN, 1234.56, -100, 0, Infinity, -Infinity];
    for (const badDeadline of invalidDeadlines) {
      await expect(
        client.dispatch({
          operationId: randomUUID(),
          profileId: "profile-list",
          revision: "rev-1",
          purpose: "mcp.list",
          body: new Uint8Array([1]),
          deadline: badDeadline,
        }),
      ).rejects.toThrow(McpPreEntryError);
      expect(fetchCount).toBe(0);
    }
  });

  it("fails pre-entry synchronously with zero binding calls if deadline or profile expires during sign preparation", async () => {
    let fetchCount = 0;
    const simulatedTime = 1_000_000;
    const profileExpiry = new Date(simulatedTime + 500).toISOString();

    const expProfile: McpReviewedProfile = {
      profileId: "profile-dyn",
      revision: "rev-1",
      purpose: "mcp.list",
      resource: "https://api.example.com/mcp",
      issuer: "https://auth.example.com/",
      credential: "none",
      maxRequestBytes: 1024,
      maxResponseBytes: 2048,
      timeoutMs: 1000,
      expiresAt: profileExpiry,
    };

    const config = resolveMcpClientConfig({
      env: {
        ...baseEnv,
        MCP_CLIENT_PROFILES_JSON: JSON.stringify([expProfile]),
      },
      binding: {
        fetch: async () => {
          fetchCount++;
          return new Response();
        },
      },
      now: () => simulatedTime,
    });
    if (!config) throw new Error("Config expected");

    // Case A: Profile expires during sign prep
    const originalDateNow = Date.now;
    try {
      let callNum = 0;
      Date.now = () => {
        callNum++;
        if (callNum > 1) {
          return simulatedTime + 600;
        }
        return simulatedTime;
      };

      const client = createMcpBrokerClient(config);
      await expect(
        client.dispatch({
          operationId: randomUUID(),
          profileId: "profile-dyn",
          revision: "rev-1",
          purpose: "mcp.list",
          body: new Uint8Array([1]),
          deadline: simulatedTime + 800,
        }),
      ).rejects.toThrow(McpPreEntryError);
      expect(fetchCount).toBe(0);
    } finally {
      Date.now = originalDateNow;
    }

    // Case B: Effective deadline crossed during sign prep
    try {
      let callNum = 0;
      Date.now = () => {
        callNum++;
        if (callNum > 1) {
          return simulatedTime + 350;
        }
        return simulatedTime;
      };

      const client = createMcpBrokerClient(config);
      await expect(
        client.dispatch({
          operationId: randomUUID(),
          profileId: "profile-dyn",
          revision: "rev-1",
          purpose: "mcp.list",
          body: new Uint8Array([1]),
          deadline: simulatedTime + 300,
        }),
      ).rejects.toThrow(McpPreEntryError);
      expect(fetchCount).toBe(0);
    } finally {
      Date.now = originalDateNow;
    }
  });

  it("times out stalled 200 body stream that hangs forever after headers", async () => {
    let cancelCalled = false;
    const neverEndingStream = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        cancelCalled = true;
      },
    });

    const client = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () =>
            new Response(neverEndingStream, {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
        },
      }) as McpClientConfig,
    );

    const deadline = Date.now() + 60;
    const start = Date.now();
    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(400);
    expect(cancelCalled).toBe(true);
  });

  it("prompts McpOutcomeUnknownError when caller aborts after 200 headers", async () => {
    let cancelCalled = false;
    const controller = new AbortController();

    const pendingStream = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        cancelCalled = true;
      },
    });

    const client = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () => {
            setTimeout(() => {
              controller.abort();
            }, 10);
            return new Response(pendingStream, { status: 200 });
          },
        },
      }) as McpClientConfig,
    );

    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
        signal: controller.signal,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);

    expect(cancelCalled).toBe(true);
  });

  it("races against total deadline even if fetch ignores abort signal", async () => {
    const client = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () => new Promise(() => {}),
        },
      }) as McpClientConfig,
    );

    const start = Date.now();
    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 60,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(400);
  });

  it("races against total deadline even if stream reader read ignores abort signal", async () => {
    const rogueResponse = {
      status: 200,
      bodyUsed: false,
      body: {
        getReader: () => ({
          read: () => new Promise(() => {}),
          cancel: () => Promise.resolve(),
        }),
      },
    } as unknown as Response;

    const client = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () => rogueResponse,
        },
      }) as McpClientConfig,
    );

    const start = Date.now();
    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 60,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(400);
  });

  it("does not hang when reader cancel never resolves", async () => {
    const oversizePadding = " ".repeat(96 * 1024 + 10);
    const mockJson =
      JSON.stringify({
        status: 200,
        body: Buffer.from("ok").toString("base64"),
        headers: { "content-type": "application/json" },
        destination: {
          profileId: "profile-large",
          revision: "rev-1",
          purpose: "mcp.call",
          address: "192.0.2.1",
        },
      }) + oversizePadding;

    const payloadBytes = new TextEncoder().encode(mockJson);
    const half = Math.floor(payloadBytes.byteLength / 2);

    const hangingCancelStream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(payloadBytes.subarray(0, half));
        c.enqueue(payloadBytes.subarray(half));
      },
      cancel() {
        return new Promise(() => {});
      },
    });

    const client = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () => new Response(hangingCancelStream, { status: 200 }),
        },
      }) as McpClientConfig,
    );

    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-large",
        revision: "rev-1",
        purpose: "mcp.call",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);
  });

  it("handles reader cancel rejection without unhandled rejection or crashing", async () => {
    const oversizePadding = " ".repeat(96 * 1024 + 10);
    const mockJson =
      JSON.stringify({
        status: 200,
        body: Buffer.from("ok").toString("base64"),
        headers: { "content-type": "application/json" },
        destination: {
          profileId: "profile-large",
          revision: "rev-1",
          purpose: "mcp.call",
          address: "192.0.2.1",
        },
      }) + oversizePadding;

    const payloadBytes = new TextEncoder().encode(mockJson);
    const half = Math.floor(payloadBytes.byteLength / 2);

    const rejectingCancelStream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(payloadBytes.subarray(0, half));
        c.enqueue(payloadBytes.subarray(half));
      },
      cancel() {
        return Promise.reject(new Error("cancel exploded"));
      },
    });

    const client = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () =>
            new Response(rejectingCancelStream, { status: 200 }),
        },
      }) as McpClientConfig,
    );

    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-large",
        revision: "rev-1",
        purpose: "mcp.call",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);
  });

  it("cancels response body stream once on 3xx redirect and non-200 responses", async () => {
    let cancel302Count = 0;
    const stream302 = new ReadableStream<Uint8Array>({
      cancel() {
        cancel302Count++;
      },
    });

    const client302 = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () =>
            new Response(stream302, {
              status: 302,
              headers: { Location: "https://evil.example.com" },
            }),
        },
      }) as McpClientConfig,
    );

    await expect(
      client302.dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);
    expect(cancel302Count).toBe(1);

    let cancel500Count = 0;
    const stream500 = new ReadableStream<Uint8Array>({
      cancel() {
        cancel500Count++;
      },
    });

    const client500 = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () =>
            new Response(stream500, {
              status: 500,
            }),
        },
      }) as McpClientConfig,
    );

    await expect(
      client500.dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);
    expect(cancel500Count).toBe(1);
  });

  it("ensures mutating exposed brokerUrl cannot redirect binding to arbitrary host, path, or query", async () => {
    let dispatchedUrl = "";
    const mockBinding = {
      fetch: async (input: RequestInfo | URL) => {
        dispatchedUrl = String(input);
        return new Response(
          JSON.stringify({
            status: 200,
            body: Buffer.from("ok").toString("base64"),
            headers: { "content-type": "application/json" },
            destination: {
              profileId: "profile-list",
              revision: "rev-1",
              purpose: "mcp.list",
              address: "192.0.2.1",
            },
          }),
        );
      },
    };

    const config = resolveMcpClientConfig({
      env: baseEnv,
      binding: mockBinding,
    });
    if (!config) throw new Error("Config expected");

    // Attempt consumer mutation on exposed brokerUrl
    const urlInstance = config.brokerUrl;
    urlInstance.hostname = "evil.example.com";
    urlInstance.pathname = "/evil/path";
    urlInstance.search = "?leak=secret";
    urlInstance.hash = "#evil";

    const client = createMcpBrokerClient(config);
    await client.dispatch({
      operationId: randomUUID(),
      profileId: "profile-list",
      revision: "rev-1",
      purpose: "mcp.list",
      body: new Uint8Array([1]),
      deadline: Date.now() + 5000,
    });

    // Proves dispatch used the immutable canonical endpoint and ignored mutation
    expect(dispatchedUrl).toBe("https://broker.example.com/v1/egress");
    expect(config.brokerUrl.hostname).toBe("broker.example.com");
    expect(config.brokerUrl.pathname).toBe("/v1/egress");
    expect(config.brokerUrl.search).toBe("");
  });

  it("cancels newly acquired response once and executes 0 reader.reads when fetch ignores abort then resolves late after timeout", async () => {
    let fetchBodyCancelCount = 0;
    let readerReadCount = 0;

    let resolveFetch: ((res: Response) => void) | undefined;
    const mockLateResponse = {
      status: 200,
      bodyUsed: false,
      body: {
        cancel: () => {
          fetchBodyCancelCount++;
          return Promise.resolve();
        },
        getReader: () => ({
          read: () => {
            readerReadCount++;
            return Promise.resolve({ done: true, value: undefined });
          },
          cancel: () => Promise.resolve(),
        }),
      },
    } as unknown as Response;

    const client = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: () =>
            new Promise((resolve) => {
              resolveFetch = resolve;
            }),
        },
      }) as McpClientConfig,
    );

    const dispatchPromise = client.dispatch({
      operationId: randomUUID(),
      profileId: "profile-list",
      revision: "rev-1",
      purpose: "mcp.list",
      body: new Uint8Array([1]),
      deadline: Date.now() + 40,
    });

    // Wait for caller dispatch to time out
    await expect(dispatchPromise).rejects.toThrow(McpOutcomeUnknownError);

    // Fetch resolves late after caller timeout
    if (resolveFetch) {
      resolveFetch(mockLateResponse);
    }

    // Yield to microtasks
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchBodyCancelCount).toBe(1);
    expect(readerReadCount).toBe(0);
  });

  it("throws McpOutcomeUnknownError if body read completes after absolute clock deadline even if timer has not run", async () => {
    let readCallCount = 0;
    const originalDateNow = Date.now;
    const fakeStartTime = 2_000_000;
    const deadline = fakeStartTime + 100;

    const mockResponse = {
      status: 200,
      bodyUsed: false,
      body: {
        getReader: () => ({
          read: () => {
            readCallCount++;
            // When read resolves, simulated clock has crossed the deadline
            Date.now = () => fakeStartTime + 200;
            return Promise.resolve({
              done: false,
              value: new TextEncoder().encode(
                JSON.stringify({
                  status: 200,
                  body: Buffer.from("ok").toString("base64"),
                  headers: { "content-type": "application/json" },
                  destination: {
                    profileId: "profile-list",
                    revision: "rev-1",
                    purpose: "mcp.list",
                    address: "192.0.2.1",
                  },
                }),
              ),
            });
          },
          cancel: () => Promise.resolve(),
        }),
      },
    } as unknown as Response;

    try {
      Date.now = () => fakeStartTime;

      const client = createMcpBrokerClient(
        resolveMcpClientConfig({
          env: baseEnv,
          binding: {
            fetch: async () => mockResponse,
          },
          now: () => fakeStartTime,
        }) as McpClientConfig,
      );

      await expect(
        client.dispatch({
          operationId: randomUUID(),
          profileId: "profile-list",
          revision: "rev-1",
          purpose: "mcp.list",
          body: new Uint8Array([1]),
          deadline,
        }),
      ).rejects.toThrow(McpOutcomeUnknownError);
    } finally {
      Date.now = originalDateNow;
    }
    expect(readCallCount).toBeGreaterThanOrEqual(1);
  });

  it("guards against late caller abort right as body completes before result return", async () => {
    const controller = new AbortController();

    const mockResponse = {
      status: 200,
      bodyUsed: false,
      body: {
        getReader: () => ({
          read: () => {
            // Abort caller right when reading finishes
            controller.abort();
            return Promise.resolve({
              done: false,
              value: new TextEncoder().encode(
                JSON.stringify({
                  status: 200,
                  body: Buffer.from("ok").toString("base64"),
                  headers: { "content-type": "application/json" },
                  destination: {
                    profileId: "profile-list",
                    revision: "rev-1",
                    purpose: "mcp.list",
                    address: "192.0.2.1",
                  },
                }),
              ),
            });
          },
          cancel: () => Promise.resolve(),
        }),
      },
    } as unknown as Response;

    const client = createMcpBrokerClient(
      resolveMcpClientConfig({
        env: baseEnv,
        binding: {
          fetch: async () => mockResponse,
        },
      }) as McpClientConfig,
    );

    await expect(
      client.dispatch({
        operationId: randomUUID(),
        profileId: "profile-list",
        revision: "rev-1",
        purpose: "mcp.list",
        body: new Uint8Array([1]),
        deadline: Date.now() + 5000,
        signal: controller.signal,
      }),
    ).rejects.toThrow(McpOutcomeUnknownError);
  });
});
