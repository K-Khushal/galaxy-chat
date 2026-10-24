/**
 * Offline scripted wire endpoint. It implements durable creation tombstones and
 * scripted outputs only: no supplied code, content or input is ever executed or
 * interpreted. All state lives for the fixture lifetime; every scripted outcome
 * is deterministic and observable through counters.
 */
export type SandboxScript = {
  create: "ok" | "reject" | "timeout" | "oversized" | "malformed";
  status: "running" | "completed" | "failed" | "oversized" | "malformed";
  logs: string;
  result: string;
};

export type SandboxGatewayFixture = {
  url: string;
  key: string;
  counters: { create: number; status: number; terminate: number };
  tombstones: () => string[];
  script: SandboxScript;
  close: () => Promise<void>;
};

export function createSandboxGatewayFixture(
  overrides: Partial<SandboxScript> = {},
): SandboxGatewayFixture {
  const key = "sandbox-fixture-gateway-key-0123456789abcdef";
  const tombstones = new Map<string, string>();
  const handles = new Map<string, string>();
  const counters = { create: 0, status: 0, terminate: 0 };
  const script: SandboxScript = {
    create: "ok",
    status: "completed",
    logs: "fixture logs: no code was executed\n",
    result: "print('fixture result')\n",
    ...overrides,
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    development: false,
    fetch: async (request) => {
      const url = new URL(request.url);
      const authorization = request.headers.get("authorization");
      if (authorization !== `Bearer ${key}`) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      if (request.method === "POST" && url.pathname === "/v1/sandboxes") {
        counters.create += 1;
        let body: { idempotencyKey?: string } = {};
        try {
          body = (await request.json()) as { idempotencyKey?: string };
        } catch {
          return Response.json({ error: "invalid" }, { status: 400 });
        }
        const idempotencyKey = body.idempotencyKey ?? "";
        if (!/^[0-9a-f-]{36}$/.test(idempotencyKey)) {
          return Response.json({ error: "invalid" }, { status: 400 });
        }
        // Durable creation tombstone: the same idempotency key always resolves
        // to the same handle and never provisions a second resource.
        const existing = tombstones.get(idempotencyKey);
        if (existing) {
          return Response.json({
            protocol: "sandbox-gateway-v1",
            idempotencyKey,
            handle: existing,
            created: true,
          });
        }
        switch (script.create) {
          case "reject":
            return Response.json(
              { error: "policy_rejected", terminal: true },
              { status: 422 },
            );
          case "timeout":
            await Bun.sleep(30_000);
            return Response.json({ error: "late" }, { status: 500 });
          case "oversized":
            tombstones.set(idempotencyKey, `h-${idempotencyKey}`);
            handles.set(`h-${idempotencyKey}`, idempotencyKey);
            return new Response("x".repeat(16_000), {
              headers: { "content-type": "application/json" },
            });
          case "malformed":
            tombstones.set(idempotencyKey, `h-${idempotencyKey}`);
            handles.set(`h-${idempotencyKey}`, idempotencyKey);
            return new Response(
              JSON.stringify({ protocol: "wrong", junk: true }).slice(0, 10),
              { headers: { "content-type": "application/json" } },
            );
          default: {
            const handle = `sbx-${idempotencyKey.slice(0, 8)}`;
            tombstones.set(idempotencyKey, handle);
            handles.set(handle, idempotencyKey);
            return Response.json({
              protocol: "sandbox-gateway-v1",
              idempotencyKey,
              handle,
              created: true,
            });
          }
        }
      }
      const statusMatch = /^\/v1\/sandboxes\/([A-Za-z0-9_-]+)\/status$/.exec(
        url.pathname,
      );
      if (request.method === "GET" && statusMatch) {
        counters.status += 1;
        const handle = statusMatch[1];
        if (!handles.has(handle)) {
          return Response.json({ error: "unknown_handle" }, { status: 404 });
        }
        switch (script.status) {
          case "oversized":
            return new Response("y".repeat(16_000), {
              headers: { "content-type": "application/json" },
            });
          case "malformed":
            return new Response("not-json-at-all", {
              headers: { "content-type": "application/json" },
            });
          case "failed":
            return Response.json({
              protocol: "sandbox-gateway-v1",
              handle,
              state: "failed",
              logs: script.logs,
              result: "",
            });
          case "running":
            return Response.json({
              protocol: "sandbox-gateway-v1",
              handle,
              state: "running",
              logs: "",
              result: "",
            });
          default:
            return Response.json({
              protocol: "sandbox-gateway-v1",
              handle,
              state: "completed",
              logs: script.logs,
              result: script.result,
            });
        }
      }
      const terminateMatch =
        /^\/v1\/sandboxes\/([A-Za-z0-9_-]+)\/terminate$/.exec(url.pathname);
      if (request.method === "POST" && terminateMatch) {
        counters.terminate += 1;
        if (!handles.has(terminateMatch[1])) {
          return Response.json({ error: "unknown_handle" }, { status: 404 });
        }
        return Response.json({
          protocol: "sandbox-gateway-v1",
          handle: terminateMatch[1],
          terminated: true,
        });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    key,
    counters,
    tombstones: () => [...tombstones.keys()],
    script,
    close: async () => {
      server.stop(true);
      await Bun.sleep(20);
    },
  };
}
