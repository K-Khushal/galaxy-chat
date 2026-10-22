import { expect, mock, test } from "bun:test";
import { rejectionOf } from "./helpers/rejection";

mock.module("server-only", () => ({}));

const { TAVILY_ENDPOINT, runTavilySearch } = await import(
  "../lib/search/adapter"
);
const { SEARCH_LIMITS } = await import("../lib/search/contract");
const { resolveCitations, validateCitationPart } = await import(
  "../lib/search/citations"
);
const { resolveSearchConfig } = await import("../lib/search/config");
const { boundedToolResult } = await import("../lib/tools/result-envelope");

const enabled = {
  BYOK_RESOURCE_SECRET: "f13b-test-resource-secret-at-least-thirty-two",
  BYOK_ACTIVE_KEY_VERSION: "v1",
  BYOK_ENCRYPTION_KEYS_JSON: JSON.stringify({
    v1: Buffer.alloc(32, 7).toString("base64"),
  }),
  SEARCH_TOOLS_ENABLED: "1",
  SEARCH_PRICE_JSON: JSON.stringify({
    id: "tavily-basic-2026-10",
    provider: "tavily",
    contract: "tavily-basic-v1",
    endpoint: "https://api.tavily.com/search",
    creditsPerRequest: 1,
    worstCaseMicrodollars: 8000,
    verified: true,
    verifiedAt: "2026-10-18T00:00:00Z",
    expiresAt: "2030-01-01T00:00:00Z",
  }),
  SEARCH_ACTOR_HOURLY_REQUESTS: "4",
  SEARCH_ACTOR_DAILY_REQUESTS: "12",
  SEARCH_GLOBAL_DAILY_REQUESTS: "100",
  SEARCH_ACTOR_DAILY_MICRODOLLARS: "96000",
  SEARCH_GLOBAL_DAILY_MICRODOLLARS: "800000",
};

test("F13-B Tavily adapter makes one fixed bounded snippet request and normalizes provenance", async () => {
  const seen: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ input: String(input), init });
      return Response.json({
        query: "safe query",
        results: [
          {
            title: "<script>\u0085Source\u202e title</script>",
            url: "https://example.com/path#fragment",
            content: "<img src=x onerror=alert(1)> search \u0085\u2066 snippet",
            score: 0.9,
          },
          {
            title: "unsafe",
            url: "javascript:alert(1)",
            content: "drop me",
            score: 0.8,
          },
          {
            title: "credential URL",
            url: "https://user:password@example.com/private",
            content: "drop me too",
          },
          {
            title: "duplicate",
            url: "https://example.com/path#another-fragment",
            content: "duplicate must not replace the first result",
          },
        ],
        response_time: 0.1,
        usage: { credits: 1 },
        request_id: "fixture-request",
      });
    },
    { preconnect: fetch.preconnect },
  );
  const result = await runTavilySearch({
    key: "fixture-tavily-key-that-is-long-enough-1234",
    query: "safe query",
    fetcher,
    now: () => new Date("2026-10-18T00:00:00Z"),
  });
  expect(seen).toHaveLength(1);
  expect(seen[0].input).toBe(TAVILY_ENDPOINT);
  expect(seen[0].init?.redirect).toBe("manual");
  expect(new Headers(seen[0].init?.headers).get("authorization")).toStartWith(
    "Bearer ",
  );
  expect(JSON.parse(String(seen[0].init?.body))).toEqual({
    query: "safe query",
    search_depth: "basic",
    chunks_per_source: 1,
    max_results: 5,
    topic: "general",
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    include_image_descriptions: false,
    include_favicon: false,
    include_published_date: false,
    auto_parameters: false,
    include_usage: true,
    safe_search: true,
  });
  expect(result).toEqual({
    status: "results",
    retrievedAt: "2026-10-18T00:00:00.000Z",
    sources: [
      {
        id: "S1",
        title: "<script>Source title</script>",
        url: "https://example.com/path",
        hostname: "example.com",
        snippet: "<img src=x onerror=alert(1)> search snippet",
      },
    ],
    usageCredits: 1,
  });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(4096);
  expect(JSON.stringify(result)).not.toMatch(/[\p{Cc}\p{Cf}]/u);
});

test("F13-B Workers-compatible manual redirects never follow or forward the key", async () => {
  for (const status of [302, 307]) {
    const seen: Array<{
      input: string;
      redirect?: RequestRedirect;
      auth: string | null;
    }> = [];
    let cancelled = 0;
    const fetcher: typeof fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.redirect === "error")
          throw new TypeError("Workers does not support redirect error mode");
        seen.push({
          input: String(input),
          redirect: init?.redirect,
          auth: new Headers(init?.headers).get("authorization"),
        });
        return new Response(
          new ReadableStream({ cancel: () => void cancelled++ }),
          {
            status,
            headers: { location: "https://redirect.invalid/steal" },
          },
        );
      },
      { preconnect: fetch.preconnect },
    );
    expect(
      await rejectionOf(
        runTavilySearch({
          key: "fixture-tavily-key-that-is-long-enough-1234",
          query: "never follow",
          fetcher,
        }),
      ),
    ).toBeDefined();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      input: TAVILY_ENDPOINT,
      redirect: "manual",
    });
    expect(seen[0].auth).toStartWith("Bearer ");
    expect(cancelled).toBe(1);
  }
});

test("F13-B adapter distinguishes honest no-results and holds ambiguous provider outcomes", async () => {
  const empty = await runTavilySearch({
    key: "fixture-tavily-key-that-is-long-enough-1234",
    query: "nothing",
    fetcher: Object.assign(
      async () =>
        Response.json({
          query: "nothing",
          results: [],
          response_time: 0.1,
          usage: { credits: 1 },
          request_id: "empty",
        }),
      { preconnect: fetch.preconnect },
    ),
  });
  expect(empty.status).toBe("no_results");
  for (const body of [
    { query: "nothing", results: [], usage: {} },
    { query: "changed", results: [], usage: { credits: 1 } },
    { query: "nothing", results: [], usage: { credits: 2 } },
  ])
    expect(
      await rejectionOf(
        runTavilySearch({
          key: "fixture-tavily-key-that-is-long-enough-1234",
          query: "nothing",
          fetcher: Object.assign(async () => Response.json(body), {
            preconnect: fetch.preconnect,
          }),
        }),
      ),
    ).toBeDefined();
  expect(
    await rejectionOf(
      runTavilySearch({
        key: "fixture-tavily-key-that-is-long-enough-1234",
        query: "x".repeat(257),
        fetcher: Object.assign(async () => Response.json({}), {
          preconnect: fetch.preconnect,
        }),
      }),
    ),
  ).toBeDefined();
});

test("F13-B source citations resolve only server evidence and reject forged IDs or URL mismatches", () => {
  const evidence = {
    status: "results" as const,
    retrievedAt: "2026-10-18T00:00:00.000Z",
    usageCredits: 1 as const,
    sources: [
      {
        id: "S1",
        title: "Example",
        url: "https://example.com/",
        hostname: "example.com",
        snippet: "Untrusted snippet",
      },
    ],
  };
  expect(resolveCitations("Supported [[S1]]", evidence).sources).toHaveLength(
    1,
  );
  expect(
    resolveCitations("Repeated [[S1]] and [[S1]]", evidence).sources,
  ).toHaveLength(1);
  expect(() => resolveCitations("Forged [[S9]]", evidence)).toThrow();
  expect(() =>
    validateCitationPart(
      { sourceId: "S1", url: "https://evil.invalid/" },
      evidence,
    ),
  ).toThrow();
});

test("F13-B adapter enforces one 10-second, 64 KiB transport and a 4 KiB evidence envelope", async () => {
  expect(SEARCH_LIMITS.timeoutMs).toBe(10_000);
  let attempts = 0;
  let declaredCancelled = 0;
  expect(
    await rejectionOf(
      runTavilySearch({
        key: "fixture-tavily-key-that-is-long-enough-1234",
        query: "bounded",
        fetcher: Object.assign(
          async () => {
            attempts++;
            return new Response(
              new ReadableStream({
                cancel() {
                  declaredCancelled++;
                },
              }),
              {
                headers: { "content-length": "65537" },
              },
            );
          },
          { preconnect: fetch.preconnect },
        ),
      }),
    ),
  ).toBeDefined();
  expect(attempts).toBe(1);
  expect(declaredCancelled).toBe(1);

  let streamCancelled = 0;
  let streamAttempts = 0;
  expect(
    await rejectionOf(
      runTavilySearch({
        key: "fixture-tavily-key-that-is-long-enough-1234",
        query: "bounded stream",
        fetcher: Object.assign(
          async () => {
            streamAttempts++;
            return new Response(
              new ReadableStream({
                pull(controller) {
                  controller.enqueue(new Uint8Array(40_000));
                },
                cancel() {
                  streamCancelled++;
                },
              }),
            );
          },
          { preconnect: fetch.preconnect },
        ),
      }),
    ),
  ).toBeDefined();
  expect(streamAttempts).toBe(1);
  expect(streamCancelled).toBe(1);

  const large = await runTavilySearch({
    key: "fixture-tavily-key-that-is-long-enough-1234",
    query: "bounded",
    fetcher: Object.assign(
      async () =>
        Response.json({
          query: "bounded",
          results: Array.from({ length: 5 }, (_, index) => ({
            title: `Source ${index} ${"t".repeat(200)}`,
            url: `https://example.com/${index}/${"u".repeat(300)}`,
            content: "s".repeat(2_000),
          })),
          usage: { credits: 1 },
        }),
      { preconnect: fetch.preconnect },
    ),
  });
  expect(Buffer.byteLength(JSON.stringify(large))).toBeLessThanOrEqual(
    SEARCH_LIMITS.contextBytes,
  );
  const envelopeText = boundedToolResult(large, SEARCH_LIMITS.contextBytes);
  const envelope = JSON.parse(envelopeText);
  expect(Buffer.byteLength(envelopeText)).toBeLessThanOrEqual(
    SEARCH_LIMITS.contextBytes,
  );
  expect(envelope.truncated).toBe(false);
  expect(JSON.parse(envelope.content)).toEqual(large);
  expect(large.sources.length).toBeLessThanOrEqual(5);
});

test("F13-B search configuration defaults off and requires every current cap", () => {
  expect(resolveSearchConfig({})).toBeUndefined();
  expect(resolveSearchConfig(enabled)?.snapshot.worstCaseMicrodollars).toBe(
    8000,
  );
  expect(
    resolveSearchConfig({ ...enabled, SEARCH_PRICE_JSON: "{}" }),
  ).toBeUndefined();
  expect(
    resolveSearchConfig({ ...enabled, SEARCH_ACTOR_DAILY_REQUESTS: "" }),
  ).toBeUndefined();
  expect(
    resolveSearchConfig({
      ...enabled,
      SEARCH_PRICE_JSON: JSON.stringify({
        ...JSON.parse(enabled.SEARCH_PRICE_JSON),
        expiresAt: "2026-10-18T00:00:00Z",
      }),
    }),
  ).toBeUndefined();
});
