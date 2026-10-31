import { describe, expect, spyOn, test } from "bun:test";
import { NextRequest } from "next/server";
import { observabilityEnv } from "@/lib/env";
import { observeRequest } from "@/lib/logger";
import { scrubEvent } from "@/lib/telemetry";
import { proxy } from "../proxy";

describe("security headers", () => {
  for (const path of ["/", "/api/credits"])
    test(path, () => {
      const response = proxy(new NextRequest(`http://localhost${path}`));
      const csp = response.headers.get("content-security-policy");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("'nonce-");
      expect(csp).toContain("https://challenges.cloudflare.com");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(response.headers.get("permissions-policy")).toBe(
        "camera=(), microphone=(), geolocation=()",
      );
    });
});
test("telemetry drops private fields, including arbitrary exception strings", () => {
  const event = scrubEvent({
    type: undefined,
    request: {
      url: "https://app/?key=secret",
      data: "secret",
      cookies: { session: "secret" },
      headers: { authorization: "secret" },
    },
    user: { email: "secret" },
    extra: { content: "secret" },
    breadcrumbs: [{ message: "secret" }],
    exception: { values: [{ value: "secret" }] },
    tags: { errorId: "internal_error" },
  });
  expect(JSON.stringify(event)).not.toContain("secret");
  expect(event.tags?.errorId).toBe("internal_error");
});
test("optional telemetry configuration is validated and defaults offline", () => {
  expect(observabilityEnv({}).SENTRY_DSN).toBeUndefined();
  expect(() => observabilityEnv({ SENTRY_DSN: "bad" })).toThrow();
  expect(() => observabilityEnv({ R2_ACCOUNT_ID: "bad" })).toThrow();
});
test("API observation preserves streaming and sets a request ID", async () => {
  const response = await observeRequest(
    new Request("http://localhost/api/chats/private?secret=yes", {
      headers: { "x-vercel-id": "iad1:abc" },
    }),
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("stream"));
            controller.close();
          },
        }),
      ),
  );
  expect(response.headers.get("x-request-id")).toBe("iad1:abc");
  expect(await response.text()).toBe("stream");
});

test("generated request ID is echoed and included in error logs", async () => {
  const { errorResponse } = await import("@/lib/api/respond");
  const write = spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    const response = await observeRequest(
      new Request("http://localhost/api/credits"),
      async () => errorResponse(new Error("private")),
    );
    const id = response.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      write.mock.calls.some(([line]) => {
        const record = JSON.parse(String(line));
        return record.level === "error" && record.requestId === id;
      }),
    ).toBe(true);
  } finally {
    write.mockRestore();
  }
});
test("production CSP has configured origins and production-only HSTS", () => {
  const previous = { ...process.env };
  try {
    process.env.SENTRY_DSN = "https://public@o123.ingest.sentry.io/1";
    process.env.R2_ACCOUNT_ID = "a".repeat(32);
    for (const mode of ["production", "development"]) {
      Object.assign(process.env, { NODE_ENV: mode });
      const response = proxy(new NextRequest("http://localhost/"));
      const csp = response.headers.get("content-security-policy")!;
      expect(response.headers.has("strict-transport-security")).toBe(
        mode === "production",
      );
      expect(csp.includes("unsafe-eval")).toBe(mode !== "production");
      expect(csp).toContain("https://o123.ingest.sentry.io");
      expect(csp).toContain(
        `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
      );
      expect(csp).toContain("https://avatars.githubusercontent.com");
      expect(csp).toContain("https://lh3.googleusercontent.com");
    }
  } finally {
    process.env = previous;
  }
});
test("telemetry keeps only source-map frame coordinates", () => {
  const event = scrubEvent({
    exception: {
      values: [
        {
          stacktrace: {
            frames: [
              {
                function: "render",
                filename: "https://app/app.js?secret",
                lineno: 12,
                vars: { secret: "secret" },
                pre_context: ["secret"],
              },
            ],
          },
        },
      ],
    },
  });
  expect(event.exception?.values?.[0].stacktrace?.frames).toEqual([
    { function: "render", filename: "https://app/app.js", lineno: 12 },
  ]);
  expect(JSON.stringify(event)).not.toContain("secret");
});
