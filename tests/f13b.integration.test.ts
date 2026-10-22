import { beforeEach, expect, mock, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { sql } from "drizzle-orm";
import { betaFixture, env, privateKey } from "./helpers/beta-fixture";
import { rejectionOf } from "./helpers/rejection";

mock.module("server-only", () => ({}));
const { startToolRun } = await import("../lib/tools/service");
const { runTavilySearch } = await import("../lib/search/adapter");
const { deleteOwnedAccount, exportOwnedAccount } = await import(
  "../lib/actions/account/account"
);
const { toolEstimate, resolveToolModel } = await import("../lib/tools/config");
const { ByokStore } = await import("../lib/byok/store");
const { SearchStore } = await import("../lib/search/store");
const { ToolStore } = await import("../lib/tools/store");
const { resolveSearchConfig } = await import("../lib/search/config");
const { resourceDigest } = await import("../lib/byok/config");
const searchRoute = await import("../app/(chat)/api/search-credentials/route");

type Result = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
const receipt = (
  content: Result["content"],
  finish: "stop" | "tool-calls" = "tool-calls",
): Result => ({
  content,
  finishReason: { unified: finish, raw: finish },
  usage: {
    inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 12, text: 12, reasoning: 0 },
  },
  warnings: [],
});
const searchEnv = {
  ...env,
  TOOLS_ENABLED: "1",
  TOOL_APPROVAL_SECRET: "f13b-fixture-approval-secret-at-least-thirty-two",
  TOOL_MODELS_JSON: JSON.stringify([
    {
      id: "f13b-private",
      adapter: "openrouter",
      model: "fixture/tools",
      provider: "fixture",
      verified: true,
      tools: true,
      reasoning: false,
      providerBudgetVerified: true,
      expiresAt: "2030-01-01T00:00:00Z",
      inputMicrodollarsPerMillion: 1000,
      outputMicrodollarsPerMillion: 1000,
    },
  ]),
  SEARCH_TOOLS_ENABLED: "1",
  SEARCH_PRICE_JSON: JSON.stringify({
    id: "tavily-basic-fixture",
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
const searchKey = "f13b-local-tavily-key-never-sent-live-123456";
async function ready() {
  const fixture = await betaFixture();
  Object.assign(process.env, searchEnv);
  await new ByokStore(fixture.db).save(
    "alice",
    "openrouter",
    privateKey,
    searchEnv,
    null,
  );
  await new SearchStore(fixture.db).save("alice", searchKey, null, searchEnv);
  return fixture;
}
let f: Awaited<ReturnType<typeof ready>>;
beforeEach(
  async () => {
    f = await ready();
  },
  { timeout: 15_000 },
);

function request() {
  const model = resolveToolModel(searchEnv, "f13b-private", "openrouter");
  const estimate = toolEstimate(model);
  return { estimate };
}
async function body(query = "current bounded web search") {
  const { estimate } = request();
  const credential = (await new SearchStore(f.db).credentials("alice"))[0];
  return {
    id: crypto.randomUUID(),
    prompt: "Use the authorized search and answer with a citation",
    funding: "openrouter" as const,
    model: "f13b-private",
    estimateMicrodollars: estimate,
    ceilingMicrodollars: estimate,
    providerBudgetAcknowledged: true as const,
    revisions: [],
    search: {
      provider: "tavily" as const,
      query,
      credentialRevision: credential.revision,
      priceRevision: "tavily-basic-fixture",
      estimateMicrodollars: 8000,
      ceilingMicrodollars: 8000,
      providerBudgetAcknowledged: true as const,
      querySharingAcknowledged: true as const,
    },
  };
}

async function runningSearchCall(
  requestBody: Awaited<ReturnType<typeof body>>,
  callId: string,
) {
  const tools = new ToolStore(f.db);
  await tools.create("alice", requestBody);
  await f.db.execute(
    sql`UPDATE tool_run SET state='running' WHERE id=${requestBody.id}`,
  );
  await tools.event("alice", requestBody.id, {
    id: callId,
    name: "webSearch",
    state: "queued",
  });
  await tools.event("alice", requestBody.id, {
    id: callId,
    name: "webSearch",
    state: "running",
  });
}

test("F13-B one authorized search uses its separate key, settles one receipt and exposes safe sources", async () => {
  const requestBody = await body();
  let generation = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () =>
      ++generation === 1
        ? receipt([
            {
              type: "tool-call",
              toolCallId: "search-1",
              toolName: "webSearch",
              input: JSON.stringify({ query: requestBody.search.query }),
            },
          ])
        : receipt(
            [
              {
                type: "source",
                sourceType: "url",
                id: "S1",
                url: "https://example.com/",
                title: "Provider-supplied duplicate provenance",
              },
              { type: "text", text: "Grounded answer [[S1]]" },
            ],
            "stop",
          ),
  });
  const calls: Array<{ key: string; query: string }> = [];
  const view = await startToolRun({
    userId: "alice",
    request: requestBody,
    env: searchEnv,
    model,
    searchAdapter: async ({ key, query }) => {
      calls.push({ key, query });
      return {
        status: "results",
        retrievedAt: "2026-10-18T00:00:00.000Z",
        usageCredits: 1,
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
    },
  });
  expect(calls).toEqual([{ key: searchKey, query: requestBody.search.query }]);
  expect(view.state).toBe("completed");
  expect(view.search?.status).toBe("results");
  expect(view.search?.sources[0].id).toBe("S1");
  expect(view.answer).toContain("[[S1]]");
  const rows = await f.db.$client.unsafe(
    "SELECT provider,kind,state,reserved_microdollars,actual_microdollars,receipt_credits FROM byok_operation ORDER BY created_at",
  );
  expect(rows.map((row) => row.kind)).toEqual(["chat", "search"]);
  expect(rows[1]).toMatchObject({
    provider: "tavily",
    kind: "search",
    state: "complete",
    reserved_microdollars: 8000,
    actual_microdollars: 8000,
    receipt_credits: 1,
  });
  expect(f.seen).toHaveLength(0);
  const exported = await exportOwnedAccount("alice");
  expect(exported.searchCredentials).toHaveLength(1);
  expect(JSON.stringify(exported)).not.toContain(searchKey);
  await deleteOwnedAccount("alice");
  expect(
    await f.db.$client.unsafe(
      "SELECT * FROM search_credential WHERE user_id='alice'",
    ),
  ).toHaveLength(0);
  expect(
    await f.db.$client.unsafe(
      "SELECT * FROM byok_operation WHERE kind='search'",
    ),
  ).toHaveLength(1);
});

test("F13-B final SDK tool envelope preserves complete bounded evidence and citation IDs", async () => {
  const requestBody = await body("escaped envelope evidence");
  let generation = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () =>
      ++generation === 1
        ? receipt([
            {
              type: "tool-call",
              toolCallId: "search-envelope",
              toolName: "webSearch",
              input: JSON.stringify({ query: requestBody.search.query }),
            },
          ])
        : receipt([{ type: "text", text: "Bounded answer [[S1]]" }], "stop"),
  });
  const view = await startToolRun({
    userId: "alice",
    request: requestBody,
    env: searchEnv,
    model,
    searchAdapter: ({ key, query, signal }) =>
      runTavilySearch({
        key,
        query,
        signal,
        fetcher: Object.assign(
          async () =>
            Response.json({
              query,
              results: Array.from({ length: 5 }, (_, index) => ({
                title: `Source ${index} ${'\\"🔥'.repeat(80)}`,
                url: `https://example.com/${index}`,
                content: `Snippet ${index} ${'\\"🔥'.repeat(350)}`,
              })),
              usage: { credits: 1 },
            }),
          { preconnect: fetch.preconnect },
        ),
      }),
  });
  expect(model.doGenerateCalls).toHaveLength(2);
  const resultPart = model.doGenerateCalls[1].prompt
    .filter((message) => message.role === "tool")
    .flatMap((message) => message.content)
    .find((part) => part.type === "tool-result");
  if (
    !resultPart ||
    resultPart.type !== "tool-result" ||
    !("value" in resultPart.output) ||
    typeof resultPart.output.value !== "string"
  )
    throw new Error("bounded search tool result missing");
  expect(Buffer.byteLength(resultPart.output.value)).toBeLessThanOrEqual(4096);
  const envelope = JSON.parse(resultPart.output.value);
  expect(envelope).toMatchObject({ untrusted: true, truncated: false });
  const delivered = JSON.parse(envelope.content);
  const persisted = JSON.parse(
    view.events.find((event) => event.id === "search-envelope")?.output ?? "",
  );
  expect(delivered).toEqual(persisted);
  expect(delivered.sources).toEqual(view.search?.sources);
  expect(delivered.sources.map((source: { id: string }) => source.id)).toEqual(
    view.search?.sources.map((source) => source.id),
  );
  expect(view.answer).toContain("[[S1]]");
  const steps = await f.db.$client.unsafe(
    "SELECT input_bytes FROM tool_step WHERE operation_id=$1",
    [requestBody.id],
  );
  expect(steps).toHaveLength(2);
  for (const step of steps) expect(step.input_bytes).toBeLessThanOrEqual(12000);
});

test("F13-B search reservation atomically binds the owned running tool call", async () => {
  const requestBody = await body();
  const searches = new SearchStore(f.db);
  await runningSearchCall(requestBody, "direct-search");
  const config = resolveSearchConfig(searchEnv);
  if (!config) throw new Error("fixture config missing");
  const operationId = crypto.randomUUID();
  await searches.reserve({
    id: operationId,
    runId: requestBody.id,
    callId: "direct-search",
    userId: "alice",
    selection: requestBody.search,
    config,
    digest: resourceDigest("direct-search", searchEnv),
    env: searchEnv,
  });
  const rows = await f.db.$client.unsafe(
    "SELECT search_operation_id FROM tool_call WHERE run_id=$1",
    [requestBody.id],
  );
  expect(rows[0].search_operation_id).toBe(operationId);
});

test("F13-B search reservation atomically enforces spend, request and concurrency caps", async () => {
  const searches = new SearchStore(f.db);
  const config = resolveSearchConfig(searchEnv);
  if (!config) throw new Error("fixture config missing");

  const overSpend = await body("spend cap");
  await runningSearchCall(overSpend, "spend-cap");
  expect(
    await rejectionOf(
      searches.reserve({
        id: crypto.randomUUID(),
        runId: overSpend.id,
        callId: "spend-cap",
        userId: "alice",
        selection: overSpend.search,
        config: {
          ...config,
          caps: { ...config.caps, actorDailyMicrodollars: 7_999 },
        },
        digest: resourceDigest("spend-cap", searchEnv),
        env: searchEnv,
      }),
    ),
  ).toMatchObject({ id: "search_resource_limited" });

  const first = await body("request cap one");
  await runningSearchCall(first, "request-one");
  const oneRequest = {
    ...config,
    caps: { ...config.caps, actorHourlyRequests: 1 },
  };
  const firstOperation = crypto.randomUUID();
  await searches.reserve({
    id: firstOperation,
    runId: first.id,
    callId: "request-one",
    userId: "alice",
    selection: first.search,
    config: oneRequest,
    digest: resourceDigest("request-one", searchEnv),
    env: searchEnv,
  });
  await searches.finish(firstOperation, "alice", "before_entry", searchEnv);

  const second = await body("request cap two");
  await runningSearchCall(second, "request-two");
  expect(
    await rejectionOf(
      searches.reserve({
        id: crypto.randomUUID(),
        runId: second.id,
        callId: "request-two",
        userId: "alice",
        selection: second.search,
        config: oneRequest,
        digest: resourceDigest("request-two", searchEnv),
        env: searchEnv,
      }),
    ),
  ).toMatchObject({ id: "search_resource_limited" });

  const concurrentA = await body("concurrency a");
  const concurrentB = await body("concurrency b");
  await runningSearchCall(concurrentA, "concurrent-a");
  await runningSearchCall(concurrentB, "concurrent-b");
  const race = await Promise.allSettled([
    searches.reserve({
      id: crypto.randomUUID(),
      runId: concurrentA.id,
      callId: "concurrent-a",
      userId: "alice",
      selection: concurrentA.search,
      config,
      digest: resourceDigest("concurrent-a", searchEnv),
      env: searchEnv,
    }),
    searches.reserve({
      id: crypto.randomUUID(),
      runId: concurrentB.id,
      callId: "concurrent-b",
      userId: "alice",
      selection: concurrentB.search,
      config,
      digest: resourceDigest("concurrent-b", searchEnv),
      env: searchEnv,
    }),
  ]);
  expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(
    1,
  );
  expect(race.filter((result) => result.status === "rejected")).toHaveLength(1);
});

test("F13-B revocation after reservation prevents entry and releases the unentered hold", async () => {
  const requestBody = await body("revoke before entry");
  const searches = new SearchStore(f.db);
  await runningSearchCall(requestBody, "revoke-before-entry");
  const config = resolveSearchConfig(searchEnv);
  if (!config) throw new Error("fixture config missing");
  const operationId = crypto.randomUUID();
  await searches.reserve({
    id: operationId,
    runId: requestBody.id,
    callId: "revoke-before-entry",
    userId: "alice",
    selection: requestBody.search,
    config,
    digest: resourceDigest("revoke-before-entry", searchEnv),
    env: searchEnv,
  });
  await searches.delete("alice", requestBody.search.credentialRevision);
  expect(
    await rejectionOf(
      searches.enter({
        id: operationId,
        runId: requestBody.id,
        callId: "revoke-before-entry",
        userId: "alice",
        selection: requestBody.search,
        snapshot: config.snapshot,
        env: searchEnv,
      }),
    ),
  ).toBeDefined();
  await searches.finish(operationId, "alice", "before_entry", searchEnv);
  const rows = await f.db.$client.unsafe(
    "SELECT state FROM byok_operation WHERE id=$1 AND kind='search'",
    [operationId],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ state: "released" });
});

test("F13-B final locked entry rejects price expiry after reservation", async () => {
  const requestBody = await body("expires after reserve");
  const searches = new SearchStore(f.db);
  await runningSearchCall(requestBody, "expires-after-reserve");
  const config = resolveSearchConfig(searchEnv);
  if (!config) throw new Error("fixture config missing");
  const operationId = crypto.randomUUID();
  await searches.reserve({
    id: operationId,
    runId: requestBody.id,
    callId: "expires-after-reserve",
    userId: "alice",
    selection: requestBody.search,
    config,
    digest: resourceDigest("expires-after-reserve", searchEnv),
    env: searchEnv,
  });
  const expiredEnv = {
    ...searchEnv,
    SEARCH_PRICE_JSON: JSON.stringify({
      ...JSON.parse(searchEnv.SEARCH_PRICE_JSON),
      expiresAt: "2026-10-18T00:00:00Z",
    }),
  };
  expect(
    await rejectionOf(
      searches.enter({
        id: operationId,
        runId: requestBody.id,
        callId: "expires-after-reserve",
        userId: "alice",
        selection: requestBody.search,
        snapshot: config.snapshot,
        env: expiredEnv,
      }),
    ),
  ).toMatchObject({ id: "search_entry_denied" });
  const [beforeRelease] = await f.db.$client.unsafe(
    "SELECT state FROM byok_operation WHERE id=$1",
    [operationId],
  );
  expect(beforeRelease).toMatchObject({ state: "reserved" });
  await searches.finish(operationId, "alice", "before_entry", searchEnv);
  const [afterRelease] = await f.db.$client.unsafe(
    "SELECT state FROM byok_operation WHERE id=$1",
    [operationId],
  );
  expect(afterRelease).toMatchObject({ state: "released" });
});

test("F13-B awaited shared lock rechecks expiry, cost and complete snapshot identity", async () => {
  for (const change of ["expiry", "cost", "identity"] as const) {
    const requestBody = await body(`locked price ${change}`);
    const searches = new SearchStore(f.db);
    const callId = `locked-${change}`;
    await runningSearchCall(requestBody, callId);
    const config = resolveSearchConfig(searchEnv);
    if (!config) throw new Error("fixture config missing");
    const operationId = crypto.randomUUID();
    await searches.reserve({
      id: operationId,
      runId: requestBody.id,
      callId,
      userId: "alice",
      selection: requestBody.search,
      config,
      digest: resourceDigest(callId, searchEnv),
      env: searchEnv,
    });
    let unlock = () => {};
    let reached = () => {};
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    // Pause completion of the real first execute: the shared advisory lock.
    const gatedDb = new Proxy(f.db, {
      get(target, property, receiver) {
        if (property !== "transaction")
          return Reflect.get(target, property, receiver);
        return (callback: Parameters<typeof f.db.transaction>[0]) =>
          target.transaction((tx) => {
            let first = true;
            return callback(
              new Proxy(tx, {
                get(targetTx, field, txReceiver) {
                  if (field !== "execute")
                    return Reflect.get(targetTx, field, txReceiver);
                  return async (...args: Parameters<typeof tx.execute>) => {
                    const result = await targetTx.execute(...args);
                    if (first) {
                      first = false;
                      reached();
                      await barrier;
                    }
                    return result;
                  };
                },
              }),
            );
          });
      },
    });
    const entryEnv = { ...searchEnv };
    const entry = rejectionOf(
      new SearchStore(gatedDb).enter({
        id: operationId,
        runId: requestBody.id,
        callId,
        userId: "alice",
        selection: requestBody.search,
        snapshot: config.snapshot,
        env: entryEnv,
      }),
    );
    await waiting;
    entryEnv.SEARCH_PRICE_JSON = JSON.stringify({
      ...config.snapshot,
      ...(change === "expiry"
        ? { expiresAt: "2026-10-18T00:00:00Z" }
        : change === "cost"
          ? { worstCaseMicrodollars: 9000 }
          : { verifiedAt: "2026-10-18T00:00:01Z" }),
    });
    unlock();
    expect(await entry).toMatchObject({ id: "search_entry_denied" });
    const [operation] = await f.db.$client.unsafe(
      "SELECT state FROM byok_operation WHERE id=$1",
      [operationId],
    );
    expect(operation.state).toBe("reserved");
    await searches.finish(operationId, "alice", "before_entry", searchEnv);
  }
});

test("F13-B a model cannot change or repeat the authorized paid query", async () => {
  const requestBody = await body();
  let adapterCalls = 0;
  let generation = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () =>
      ++generation === 1
        ? receipt([
            {
              type: "tool-call",
              toolCallId: "forged",
              toolName: "webSearch",
              input: JSON.stringify({ query: "different paid query" }),
            },
          ])
        : receipt([{ type: "text", text: "No evidence" }], "stop"),
  });
  const view = await startToolRun({
    userId: "alice",
    request: requestBody,
    env: searchEnv,
    model,
    searchAdapter: async () => {
      adapterCalls++;
      throw new Error();
    },
  });
  expect(adapterCalls).toBe(0);
  expect(view.search?.status).toBe("not_used");
  expect(view.answer).toContain("Search was authorized but not used");
  expect(
    await f.db.$client.unsafe(
      "SELECT * FROM byok_operation WHERE kind='search'",
    ),
  ).toHaveLength(0);
});

test("F13-B changed price proof is rejected before search credential entry", async () => {
  const requestBody = await body();
  const mutableEnv = { ...searchEnv };
  let generation = 0;
  let adapterCalls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      generation++;
      if (generation === 1) {
        mutableEnv.SEARCH_PRICE_JSON = JSON.stringify({
          ...JSON.parse(searchEnv.SEARCH_PRICE_JSON),
          id: "changed-price-proof",
        });
        return receipt([
          {
            type: "tool-call",
            toolCallId: "stale-price",
            toolName: "webSearch",
            input: JSON.stringify({ query: requestBody.search.query }),
          },
        ]);
      }
      return receipt([{ type: "text", text: "No current evidence" }], "stop");
    },
  });
  const view = await startToolRun({
    userId: "alice",
    request: requestBody,
    env: mutableEnv,
    model,
    searchAdapter: async () => {
      adapterCalls++;
      throw new Error();
    },
  });
  expect(adapterCalls).toBe(0);
  expect(view.search?.status).toBe("provider_error");
  expect(
    await f.db.$client.unsafe(
      "SELECT * FROM byok_operation WHERE kind='search'",
    ),
  ).toHaveLength(0);
});

test("F13-B post-entry provider ambiguity is held and shown as provider error", async () => {
  const requestBody = await body();
  let generation = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () =>
      ++generation === 1
        ? receipt([
            {
              type: "tool-call",
              toolCallId: "search-fails",
              toolName: "webSearch",
              input: JSON.stringify({ query: requestBody.search.query }),
            },
          ])
        : receipt([{ type: "text", text: "Search unavailable" }], "stop"),
  });
  const view = await startToolRun({
    userId: "alice",
    request: requestBody,
    env: searchEnv,
    model,
    searchAdapter: async () => {
      throw new Error("private provider body");
    },
  });
  if (!view.events.length) throw new Error("no events");
  expect(view.events.map((event) => [event.name, event.state])).toEqual([
    ["webSearch", "failed"],
  ]);
  expect(view.events[0].output).toContain("tool_failed");
  expect(view.search?.status).toBe("provider_error");
  const [operation] = await f.db.$client.unsafe(
    "SELECT state,actual_microdollars,receipt_credits FROM byok_operation WHERE kind='search'",
  );
  expect(operation).toMatchObject({
    state: "held",
    actual_microdollars: null,
    receipt_credits: null,
  });
  expect(JSON.stringify(view)).not.toContain("private provider body");
});

test("F13-B oversized provider stream cancels promptly and retains its entered hold", async () => {
  const requestBody = await body("oversized provider response");
  let generation = 0;
  let cancelled = 0;
  let attempts = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () =>
      ++generation === 1
        ? receipt([
            {
              type: "tool-call",
              toolCallId: "search-overflow",
              toolName: "webSearch",
              input: JSON.stringify({ query: requestBody.search.query }),
            },
          ])
        : receipt([{ type: "text", text: "Search unavailable" }], "stop"),
  });
  const view = await startToolRun({
    userId: "alice",
    request: requestBody,
    env: searchEnv,
    model,
    searchAdapter: ({ key, query, signal }) =>
      runTavilySearch({
        key,
        query,
        signal,
        fetcher: Object.assign(
          async () => {
            attempts++;
            return new Response(
              new ReadableStream({
                pull(controller) {
                  controller.enqueue(new Uint8Array(40_000));
                },
                cancel() {
                  cancelled++;
                },
              }),
            );
          },
          { preconnect: fetch.preconnect },
        ),
      }),
  });
  expect(attempts).toBe(1);
  expect(cancelled).toBe(1);
  expect(view.search?.status).toBe("provider_error");
  const [operation] = await f.db.$client.unsafe(
    "SELECT state,actual_microdollars,receipt_credits FROM byok_operation WHERE kind='search'",
  );
  expect(operation).toMatchObject({
    state: "held",
    actual_microdollars: null,
    receipt_credits: null,
  });
});

test("F13-B search credentials are owner-scoped, revision-bound and never exposed", async () => {
  const alice = await searchRoute.GET(
    await f.request("/api/search-credentials"),
  );
  expect(alice.status).toBe(200);
  expect(alice.headers.get("cache-control")).toBe("private, no-store");
  const value = await alice.json();
  expect(value.credentials[0].maskedKey).toBe(`••••${searchKey.slice(-4)}`);
  expect(JSON.stringify(value)).not.toContain(searchKey);
  const revision = value.credentials[0].revision;
  expect(
    (
      await searchRoute.DELETE(
        await f.request(
          "/api/search-credentials",
          { provider: "tavily", revision },
          "bob",
        ),
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await searchRoute.DELETE(
        await f.request("/api/search-credentials", {
          provider: "tavily",
          revision,
        }),
      )
    ).status,
  ).toBe(200);
  expect(await new SearchStore(f.db).credentials("alice")).toHaveLength(0);
  expect(
    await rejectionOf(new SearchStore(f.db).delete("alice", revision)),
  ).toBeDefined();
});

test("F13-B model receives separately authorized query as explicitly labelled user data within 12-KiB accounting", async () => {
  const arbitraryQuery = "arbitrary-authorized-query-🔭-9876";
  const requestBody = await body(arbitraryQuery);
  requestBody.prompt = "Use the authorized search and summarize it.";

  let generation = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async (params) => {
      generation++;
      if (generation === 1) {
        const userMsg = params.prompt.find((m) => m.role === "user");
        const sysMsg = params.prompt.find((m) => m.role === "system");

        const sysText =
          typeof sysMsg?.content === "string"
            ? sysMsg.content
            : JSON.stringify(sysMsg?.content ?? "");
        expect(sysText).not.toContain(arbitraryQuery);

        const userText = Array.isArray(userMsg?.content)
          ? userMsg.content.map((p) => ("text" in p ? p.text : "")).join("")
          : String(userMsg?.content ?? "");
        expect(userText).toContain(
          `Authorized search query: ${arbitraryQuery}`,
        );

        const match = /Authorized search query:\s*(.+)$/m.exec(userText);
        const extractedQuery = match ? match[1].trim() : "";

        return receipt([
          {
            type: "tool-call",
            toolCallId: "search-a",
            toolName: "webSearch",
            input: JSON.stringify({ query: extractedQuery }),
          },
        ]);
      }
      return receipt(
        [
          {
            type: "source",
            sourceType: "url",
            id: "S1",
            url: "https://example.com/",
            title: "Result Title",
          },
          { type: "text", text: "Answer with [[S1]]" },
        ],
        "stop",
      );
    },
  });

  const adapterCalls: string[] = [];
  const view = await startToolRun({
    userId: "alice",
    request: requestBody,
    env: searchEnv,
    model,
    searchAdapter: async ({ query }) => {
      adapterCalls.push(query);
      return {
        status: "results",
        retrievedAt: "2026-10-18T00:00:00.000Z",
        usageCredits: 1,
        sources: [
          {
            id: "S1",
            title: "Result Title",
            url: "https://example.com/",
            hostname: "example.com",
            snippet: "Snippet text",
          },
        ],
      };
    },
  });

  expect(adapterCalls).toEqual([arbitraryQuery]);
  expect(view.state).toBe("completed");
  expect(view.search?.status).toBe("results");
  expect(view.answer).toContain("[[S1]]");

  const steps = await f.db.$client.unsafe(
    "SELECT input_bytes FROM tool_step WHERE operation_id=$1",
    [requestBody.id],
  );
  expect(steps).toHaveLength(2);
  for (const step of steps) {
    expect(step.input_bytes).toBeLessThanOrEqual(12000);
  }
});

test("F13-B pre-entry release returns monetary reservation capacity under exact 8000 microdollar cap", async () => {
  const searches = new SearchStore(f.db);
  const config = resolveSearchConfig(searchEnv);
  if (!config) throw new Error("fixture config missing");

  const exactCapConfig = {
    ...config,
    caps: {
      ...config.caps,
      actorDailyMicrodollars: 8000,
      globalDailyMicrodollars: 8000,
    },
  };

  const req1 = await body("release-capacity-1");
  await runningSearchCall(req1, "call-1");
  const op1 = crypto.randomUUID();

  await searches.reserve({
    id: op1,
    runId: req1.id,
    callId: "call-1",
    userId: "alice",
    selection: req1.search,
    config: exactCapConfig,
    digest: resourceDigest("call-1", searchEnv),
    env: searchEnv,
  });

  const reqFail = await body("release-capacity-fail");
  await runningSearchCall(reqFail, "call-fail");
  expect(
    await rejectionOf(
      searches.reserve({
        id: crypto.randomUUID(),
        runId: reqFail.id,
        callId: "call-fail",
        userId: "alice",
        selection: reqFail.search,
        config: exactCapConfig,
        digest: resourceDigest("call-fail", searchEnv),
        env: searchEnv,
      }),
    ),
  ).toMatchObject({ id: "search_resource_limited" });

  await searches.finish(op1, "alice", "before_entry", searchEnv);
  const [releasedRow] = await f.db.$client.unsafe(
    "SELECT state FROM byok_operation WHERE id=$1",
    [op1],
  );
  expect(releasedRow).toMatchObject({ state: "released" });

  const req2 = await body("release-capacity-2");
  await runningSearchCall(req2, "call-2");
  const op2 = crypto.randomUUID();
  await searches.reserve({
    id: op2,
    runId: req2.id,
    callId: "call-2",
    userId: "alice",
    selection: req2.search,
    config: exactCapConfig,
    digest: resourceDigest("call-2", searchEnv),
    env: searchEnv,
  });

  await searches.enter({
    id: op2,
    runId: req2.id,
    callId: "call-2",
    userId: "alice",
    selection: req2.search,
    snapshot: exactCapConfig.snapshot,
    env: searchEnv,
  });
  const [enteredRow] = await f.db.$client.unsafe(
    "SELECT state FROM byok_operation WHERE id=$1",
    [op2],
  );
  expect(enteredRow).toMatchObject({ state: "entered" });

  const req3 = await body("release-capacity-3");
  await runningSearchCall(req3, "call-3");
  expect(
    await rejectionOf(
      searches.reserve({
        id: crypto.randomUUID(),
        runId: req3.id,
        callId: "call-3",
        userId: "alice",
        selection: req3.search,
        config: exactCapConfig,
        digest: resourceDigest("call-3", searchEnv),
        env: searchEnv,
      }),
    ),
  ).toMatchObject({ id: "search_resource_limited" });

  await searches.finish(op2, "alice", "before_entry", searchEnv);
  const [heldRow] = await f.db.$client.unsafe(
    "SELECT state,reserved_microdollars FROM byok_operation WHERE id=$1",
    [op2],
  );
  expect(heldRow).toMatchObject({
    state: "held",
    reserved_microdollars: 8000,
  });

  const req4 = await body("release-capacity-4");
  await runningSearchCall(req4, "call-4");
  expect(
    await rejectionOf(
      searches.reserve({
        id: crypto.randomUUID(),
        runId: req4.id,
        callId: "call-4",
        userId: "alice",
        selection: req4.search,
        config: exactCapConfig,
        digest: resourceDigest("call-4", searchEnv),
        env: searchEnv,
      }),
    ),
  ).toMatchObject({ id: "search_resource_limited" });

  const countConfig = {
    ...config,
    caps: {
      ...config.caps,
      actorDailyRequests: 2,
      actorDailyMicrodollars: 96000,
      globalDailyMicrodollars: 800000,
    },
  };
  const reqCount = await body("release-count-limit");
  await runningSearchCall(reqCount, "call-count");
  expect(
    await rejectionOf(
      searches.reserve({
        id: crypto.randomUUID(),
        runId: reqCount.id,
        callId: "call-count",
        userId: "alice",
        selection: reqCount.search,
        config: countConfig,
        digest: resourceDigest("call-count", searchEnv),
        env: searchEnv,
      }),
    ),
  ).toMatchObject({ id: "search_resource_limited" });
});

test("F13-B 100+ emoji and mixed-script sources persist through tool run, parse schema and fit envelope", async () => {
  const requestBody = await body("unicode sources run");
  let generation = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () =>
      ++generation === 1
        ? receipt([
            {
              type: "tool-call",
              toolCallId: "search-u",
              toolName: "webSearch",
              input: JSON.stringify({ query: requestBody.search.query }),
            },
          ])
        : receipt([{ type: "text", text: "Answer [[S1]]" }], "stop"),
  });

  const view = await startToolRun({
    userId: "alice",
    request: requestBody,
    env: searchEnv,
    model,
    searchAdapter: ({ key, query, signal }) =>
      runTavilySearch({
        key,
        query,
        signal,
        fetcher: Object.assign(
          async () =>
            Response.json({
              query,
              results: [
                {
                  title: "🔥".repeat(120),
                  url: "https://example.com/emojis",
                  content: "🚀".repeat(400),
                },
                {
                  title: `\u202E\u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u4E2D\u6587 ${"🌟".repeat(90)}`,
                  url: "https://example.com/mixed",
                  content: `\u0085\u200E ${"🎉".repeat(380)} text`,
                },
              ],
              usage: { credits: 1 },
            }),
          { preconnect: fetch.preconnect },
        ),
      }),
  });

  expect(view.state).toBe("completed");
  expect(view.search?.status).toBe("results");
  expect(view.search?.sources).toHaveLength(2);
  expect(view.search?.sources[0].id).toBe("S1");
  expect(view.search?.sources[1].id).toBe("S2");
  for (const s of view.search?.sources ?? []) {
    expect(s.title.length).toBeLessThanOrEqual(160);
    expect(s.snippet.length).toBeLessThanOrEqual(700);
  }
  const viewJson = JSON.stringify(view);
  const hasLoneSurrogate =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
      viewJson,
    );
  expect(hasLoneSurrogate).toBe(false);
  expect(viewJson).not.toMatch(/[\p{Cc}\p{Cf}]/u);
});

test("F13-B search view reflects executed search after earlier denied mismatch", async () => {
  const requestBody = await body("authorized query D");
  let generation = 0;
  let adapterCalls = 0;

  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      generation++;
      if (generation === 1) {
        return receipt([
          {
            type: "tool-call",
            toolCallId: "wrong-query-call",
            toolName: "webSearch",
            input: JSON.stringify({ query: "denied wrong query" }),
          },
        ]);
      }
      if (generation === 2) {
        return receipt([
          {
            type: "tool-call",
            toolCallId: "correct-query-call",
            toolName: "webSearch",
            input: JSON.stringify({ query: requestBody.search.query }),
          },
        ]);
      }
      return receipt(
        [
          {
            type: "source",
            sourceType: "url",
            id: "S1",
            url: "https://example.com/",
            title: "Source Title",
          },
          { type: "text", text: "Answer grounded in [[S1]]" },
        ],
        "stop",
      );
    },
  });

  const view = await startToolRun({
    userId: "alice",
    request: requestBody,
    env: searchEnv,
    model,
    searchAdapter: async () => {
      adapterCalls++;
      return {
        status: "results",
        retrievedAt: "2026-10-18T00:00:00.000Z",
        usageCredits: 1,
        sources: [
          {
            id: "S1",
            title: "Source Title",
            url: "https://example.com/",
            hostname: "example.com",
            snippet: "Snippet text",
          },
        ],
      };
    },
  });

  expect(adapterCalls).toBe(1);
  expect(view.state).toBe("completed");
  expect(view.events.map((e) => [e.name, e.state])).toEqual([
    ["webSearch", "denied"],
    ["webSearch", "completed"],
  ]);
  expect(view.search?.status).toBe("results");
  expect(view.search?.sources[0].id).toBe("S1");
  expect(view.answer).toContain("[[S1]]");
  expect(view.answer).not.toContain("Search was authorized but not used");

  const rows = await f.db.$client.unsafe(
    "SELECT state,reserved_microdollars,actual_microdollars,receipt_credits FROM byok_operation WHERE kind='search'",
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    state: "complete",
    reserved_microdollars: 8000,
    actual_microdollars: 8000,
    receipt_credits: 1,
  });
});

test("F13-B search view reflects no_results when executed search has no results after earlier denial", async () => {
  const requestBody = await body("empty query D");
  let generation = 0;
  let adapterCalls = 0;

  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      generation++;
      if (generation === 1) {
        return receipt([
          {
            type: "tool-call",
            toolCallId: "denied-call",
            toolName: "webSearch",
            input: JSON.stringify({ query: "denied wrong query" }),
          },
        ]);
      }
      if (generation === 2) {
        return receipt([
          {
            type: "tool-call",
            toolCallId: "empty-call",
            toolName: "webSearch",
            input: JSON.stringify({ query: requestBody.search.query }),
          },
        ]);
      }
      return receipt([{ type: "text", text: "No results found" }], "stop");
    },
  });

  const view = await startToolRun({
    userId: "alice",
    request: requestBody,
    env: searchEnv,
    model,
    searchAdapter: async () => {
      adapterCalls++;
      return {
        status: "no_results",
        retrievedAt: "2026-10-18T00:00:00.000Z",
        usageCredits: 1,
        sources: [],
      };
    },
  });

  expect(adapterCalls).toBe(1);
  expect(view.state).toBe("completed");
  expect(view.search?.status).toBe("no_results");
  expect(view.search?.sources).toHaveLength(0);
});

test("F13-B search view reflects provider_error when executed search fails after earlier denial", async () => {
  const requestBody = await body("failed query D");
  let generation = 0;
  let adapterCalls = 0;

  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      generation++;
      if (generation === 1) {
        return receipt([
          {
            type: "tool-call",
            toolCallId: "denied-call",
            toolName: "webSearch",
            input: JSON.stringify({ query: "denied wrong query" }),
          },
        ]);
      }
      if (generation === 2) {
        return receipt([
          {
            type: "tool-call",
            toolCallId: "failing-call",
            toolName: "webSearch",
            input: JSON.stringify({ query: requestBody.search.query }),
          },
        ]);
      }
      return receipt([{ type: "text", text: "Search failed" }], "stop");
    },
  });

  const view = await startToolRun({
    userId: "alice",
    request: requestBody,
    env: searchEnv,
    model,
    searchAdapter: async () => {
      adapterCalls++;
      throw new Error("provider exploded");
    },
  });

  expect(adapterCalls).toBe(1);
  expect(view.state).toBe("completed");
  expect(view.events.map((e) => [e.name, e.state])).toEqual([
    ["webSearch", "denied"],
    ["webSearch", "failed"],
  ]);
  expect(view.search?.status).toBe("provider_error");
  expect(view.search?.sources).toHaveLength(0);

  const [operation] = await f.db.$client.unsafe(
    "SELECT state FROM byok_operation WHERE kind='search'",
  );
  expect(operation).toMatchObject({ state: "held" });
});
