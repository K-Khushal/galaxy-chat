import { beforeEach, expect, mock, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { betaFixture, env, privateKey } from "./helpers/beta-fixture";
import { rejectionOf } from "./helpers/rejection";

mock.module("server-only", () => ({}));
const { startToolRun } = await import("../lib/tools/service");
const { ToolStore, canonical } = await import("../lib/tools/store");
const { ByokStore } = await import("../lib/byok/store");
const route = await import("../app/(chat)/api/tools/route");
const { toolEstimate, resolveToolModel } = await import("../lib/tools/config");
const { exportOwnedAccount, deleteOwnedAccount } = await import(
  "../lib/actions/account/account"
);
type Result = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
function receipt(
  content: Result["content"],
  finish: "stop" | "tool-calls" = "tool-calls",
): Result {
  return {
    content,
    finishReason: { unified: finish, raw: finish },
    usage: {
      inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 12, text: 12, reasoning: 0 },
    },
    warnings: [],
  };
}
const toolEnv = {
  ...env,
  TOOLS_ENABLED: "1",
  TOOL_APPROVAL_SECRET: "f13-fixture-nonfunctional-approval-secret-long-enough",
  TOOL_MODELS_JSON: JSON.stringify([
    {
      id: "f13-private",
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
};
function request() {
  const estimate = toolEstimate(
    resolveToolModel(toolEnv, "f13-private", "openrouter"),
  );
  return {
    id: crypto.randomUUID(),
    prompt: "Calculate 2 plus 3",
    funding: "openrouter" as const,
    model: "f13-private",
    estimateMicrodollars: estimate,
    ceilingMicrodollars: estimate,
    providerBudgetAcknowledged: true as const,
    revisions: [],
  };
}
async function ready() {
  const f = await betaFixture();
  Object.assign(process.env, toolEnv);
  await new ByokStore(f.db).save(
    "alice",
    "openrouter",
    privateKey,
    toolEnv,
    null,
  );
  return f;
}
type Fixture = Awaited<ReturnType<typeof ready>>;
const fixtureSetupTimeout = 15_000;
let f: Fixture;
beforeEach(
  async () => {
    f = await ready();
  },
  { timeout: fixtureSetupTimeout },
);
test("F13 durable actual SDK steps, per-run idempotency, owner isolation and account export/deletion", async () => {
  const body = request();
  const model: MockLanguageModelV4 = new MockLanguageModelV4({
    doGenerate: async () =>
      model.doGenerateCalls.length === 1
        ? receipt([
            {
              type: "tool-call",
              toolCallId: "add",
              toolName: "arithmetic",
              input: '{"operation":"add","left":2,"right":3}',
            },
          ])
        : receipt([{ type: "text", text: "5" }], "stop"),
  });
  const view = await startToolRun({
    userId: "alice",
    request: body,
    env: toolEnv,
    model,
  });
  expect(view.state).toBe("completed");
  expect(view.answer).toBe("5");
  expect(view.events[0].state).toBe("completed");
  expect(model.doGenerateCalls).toHaveLength(2);
  expect(
    (
      await f.db.$client.unsafe(
        "SELECT state FROM byok_operation WHERE id=$1",
        [body.id],
      )
    )[0].state,
  ).toBe("complete");
  expect(
    await f.db.$client.unsafe("SELECT * FROM tool_step WHERE operation_id=$1", [
      body.id,
    ]),
  ).toHaveLength(2);
  expect(
    await rejectionOf(
      startToolRun({ userId: "alice", request: body, env: toolEnv, model }),
    ),
  ).toBeDefined();
  expect(model.doGenerateCalls).toHaveLength(2);
  expect(
    (
      await route.GET(
        await f.request(`/api/tools?id=${body.id}`, undefined, "bob"),
      )
    ).status,
  ).toBe(404);
  const exported = await exportOwnedAccount("alice");
  expect(exported.toolData.runs).toHaveLength(1);
  expect(exported.toolData.calls).toHaveLength(1);
  expect(JSON.stringify(exported)).not.toContain(privateKey);
  await deleteOwnedAccount("alice");
  expect(await f.db.$client.unsafe("SELECT * FROM tool_run")).toHaveLength(0);
  expect(await f.db.$client.unsafe("SELECT * FROM tool_call")).toHaveLength(0);
  expect(await f.db.$client.unsafe("SELECT * FROM tool_step")).toHaveLength(2);
  expect(
    await f.db.$client.unsafe("SELECT * FROM byok_operation"),
  ).toHaveLength(1);
  expect(f.seen).toHaveLength(0);
});
test("F13 unknown usage and cancellation retain resource holds and never fallback to platform", async () => {
  const body = request();
  const controller = new AbortController();
  const model: MockLanguageModelV4 = new MockLanguageModelV4({
    doGenerate: async () => {
      controller.abort();
      return receipt([{ type: "text", text: "remote may still run" }], "stop");
    },
  });
  expect(
    await rejectionOf(
      startToolRun({
        userId: "alice",
        request: body,
        env: toolEnv,
        model,
        signal: controller.signal,
      }),
    ),
  ).toBeDefined();
  expect(
    (
      await f.db.$client.unsafe(
        "SELECT state FROM byok_operation WHERE id=$1",
        [body.id],
      )
    )[0].state,
  ).toBe("held");
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(
    await f.db.$client.unsafe("SELECT * FROM credit_reservation"),
  ).toHaveLength(0);
  expect(f.seen).toHaveLength(0);
});
test("F13 credential replacement is rechecked before every actual model continuation", async () => {
  const body = request();
  const model: MockLanguageModelV4 = new MockLanguageModelV4({
    doGenerate: async () => {
      const key = (await new ByokStore(f.db).credentials("alice"))[0];
      await new ByokStore(f.db).save(
        "alice",
        "openrouter",
        `${privateKey}changed`,
        toolEnv,
        key.revision,
      );
      return receipt([
        {
          type: "tool-call",
          toolCallId: "add",
          toolName: "arithmetic",
          input: '{"operation":"add","left":2,"right":3}',
        },
      ]);
    },
  });
  expect(
    await rejectionOf(
      startToolRun({ userId: "alice", request: body, env: toolEnv, model }),
    ),
  ).toBeDefined();
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(
    (
      await f.db.$client.unsafe(
        "SELECT state FROM byok_operation WHERE id=$1",
        [body.id],
      )
    )[0].state,
  ).toBe("held");
});
test("F13 exact-action approvals require durable owner decisions, expire, revoke and consume once", async () => {
  const store = new ToolStore(f.db);
  const body = request();
  await store.create("alice", body);
  const binding = {
    runId: body.id,
    toolCallId: "inert-call",
    tool: "fixtureOnly",
    toolRevision: "v1",
    connectionRevision: "c1",
    arguments: { b: 2, a: 1 },
    target: "inert-target",
    costMicrodollars: 3,
  };
  const issue = () =>
    store.issueApproval("alice", binding, new Date(Date.now() + 60000));
  let executions = 0;
  const execute = async (id: string, changed = binding) => {
    await store.consumeApproval("alice", id, changed);
    executions++;
  };
  const forged = await issue();
  expect(await rejectionOf(execute(forged))).toBeDefined();
  expect(
    await rejectionOf(store.decideApproval("bob", forged, "approve")),
  ).toBeDefined();
  await store.decideApproval("alice", forged, "approve");
  expect(
    await rejectionOf(
      execute(forged, { ...binding, arguments: { a: 1, b: 3 } }),
    ),
  ).toBeDefined();
  await execute(forged, { ...binding, arguments: { a: 1, b: 2 } });
  expect(await rejectionOf(execute(forged))).toBeDefined();
  expect(executions).toBe(1);
  const revoked = await issue();
  await store.decideApproval("alice", revoked, "approve");
  await store.decideApproval("alice", revoked, "revoke");
  expect(await rejectionOf(execute(revoked))).toBeDefined();
  const expired = await issue();
  await store.decideApproval("alice", expired, "approve");
  await f.db.$client.unsafe(
    "UPDATE tool_approval SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expired],
  );
  expect(await rejectionOf(execute(expired))).toBeDefined();
  const denied = await issue();
  await store.decideApproval("alice", denied, "deny");
  expect(await rejectionOf(execute(denied))).toBeDefined();
  expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
  expect((await exportOwnedAccount("alice")).toolData.approvals).toHaveLength(
    4,
  );
  await deleteOwnedAccount("alice");
  expect(await f.db.$client.unsafe("SELECT * FROM tool_approval")).toHaveLength(
    0,
  );
});
test("F13 route rejects platform, temporary, forged approval booleans and guests before inference", async () => {
  for (const changed of [
    { funding: "platform" },
    { temporary: true },
    { approved: true },
    { providerBudgetAcknowledged: false },
    { estimateMicrodollars: 0 },
    { ceilingMicrodollars: 0 },
  ]) {
    const response = await route.POST(
      await f.request("/api/tools", {
        action: "run",
        request: { ...request(), ...changed },
      }),
    );
    expect(response.status).toBe(400);
  }
  const noSession = new Request("https://galaxy.example/api/tools", {
    method: "POST",
    headers: {
      origin: "https://galaxy.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "run", request: request() }),
  });
  expect((await route.POST(noSession)).status).toBe(401);
  delete process.env.TOOLS_ENABLED;
  expect(
    (
      await route.POST(
        await f.request("/api/tools", { action: "run", request: request() }),
      )
    ).status,
  ).toBe(503);
  expect(
    await f.db.$client.unsafe("SELECT * FROM byok_operation"),
  ).toHaveLength(0);
  expect(f.seen).toHaveLength(0);
});

test("F13 real SDK signed approval protocol still requires a durable decision and single-use action claim", async () => {
  const { ToolLoopAgent, isStepCount, tool } = await import("ai");
  const { z } = await import("zod");
  const store = new ToolStore(f.db);
  const body = request();
  await store.create("alice", body);
  const binding = {
    runId: body.id,
    toolCallId: "fixture-write",
    tool: "inert",
    toolRevision: "v1",
    connectionRevision: "fixture-revision",
    arguments: { value: 1 },
    target: "inert-only",
    costMicrodollars: 0,
  };
  const approvalId = await store.issueApproval(
    "alice",
    binding,
    new Date(Date.now() + 60000),
  );
  let executions = 0;
  const model: MockLanguageModelV4 = new MockLanguageModelV4({
    doGenerate: async () =>
      model.doGenerateCalls.length === 1
        ? receipt([
            {
              type: "tool-call",
              toolCallId: "fixture-write",
              toolName: "inert",
              input: '{"value":1}',
            },
          ])
        : receipt([{ type: "text", text: "Fixture ended" }], "stop"),
  });
  const agent = new ToolLoopAgent({
    model,
    maxRetries: 0,
    maxOutputTokens: 170,
    stopWhen: isStepCount(1),
    experimental_toolApprovalSecret: toolEnv.TOOL_APPROVAL_SECRET,
    tools: {
      inert: tool({
        inputSchema: z.object({ value: z.number().int() }).strict(),
        execute: async (input, { toolCallId }) => {
          await store.consumeApproval("alice", approvalId, {
            ...binding,
            toolCallId,
            arguments: input,
          });
          executions++;
          return "inert";
        },
      }),
    },
    toolApproval: { inert: "user-approval" },
  });
  const first = await agent.generate({ prompt: "Inert fixture only" });
  const approval = first.content.find(
    (p) => p.type === "tool-approval-request",
  );
  if (!approval || approval.type !== "tool-approval-request")
    throw new Error("fixture_approval_missing");
  const messages: import("ai").ModelMessage[] = [
    ...first.responseMessages,
    {
      role: "tool",
      content: [
        {
          type: "tool-approval-response",
          approvalId: approval.approvalId,
          approved: true,
        },
      ],
    },
  ];
  await agent.generate({ messages });
  expect(executions).toBe(0);
  await store.decideApproval("alice", approvalId, "approve");
  await agent.generate({ messages });
  expect(executions).toBe(1);
  // A replay consumes no new action. The existing durable claim rejects before effects.
  expect(
    await rejectionOf(store.consumeApproval("alice", approvalId, binding)),
  ).toBeDefined();
  expect(model.doGenerateCalls.length).toBeLessThanOrEqual(3);
  expect(f.seen).toHaveLength(0);
});

test("F13 owned immutable revision reads exclude other owners, changed selection and deleted revisions", async () => {
  await f.db.$client
    .unsafe(
      `INSERT INTO chat(id,user_id,title) VALUES ('f13-chat','alice','Tools'),('f13-bob-chat','bob','Private'); INSERT INTO chat_message(id,chat_id,user_id,role,parts,attachments) VALUES ('f13-message','f13-chat','alice','assistant','[]','[]'),('f13-bob-message','f13-bob-chat','bob','assistant','[]','[]'); INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES ('selected','alice','f13-chat','f13-message','markdown',2),('bob-private','bob','f13-bob-chat','f13-bob-message','markdown',1); INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) VALUES ('selected','alice',1,'Old','Chosen immutable source'),('selected','alice',2,'New','Unselected newer source'),('bob-private','bob',1,'Private','Bob secret')`,
    )
    .simple();
  const store = new ToolStore(f.db);
  expect(
    await store.readRevision(
      "alice",
      [{ artifactId: "selected", version: 1 }],
      { artifactId: "selected", version: 1, offset: 0, length: 100 },
    ),
  ).toMatchObject({ content: "Chosen immutable source", untrusted: true });
  expect(
    await rejectionOf(
      store.readRevision("bob", [{ artifactId: "selected", version: 1 }], {
        artifactId: "selected",
        version: 1,
        offset: 0,
        length: 100,
      }),
    ),
  ).toBeDefined();
  expect(
    await rejectionOf(
      store.readRevision("alice", [{ artifactId: "selected", version: 1 }], {
        artifactId: "selected",
        version: 2,
        offset: 0,
        length: 100,
      }),
    ),
  ).toBeDefined();
  const body = {
    ...request(),
    revisions: [{ artifactId: "bob-private", version: 1 }],
  };
  const model: MockLanguageModelV4 = new MockLanguageModelV4({
    doGenerate: receipt([{ type: "text", text: "Never called" }], "stop"),
  });
  expect(
    await rejectionOf(
      startToolRun({ userId: "alice", request: body, env: toolEnv, model }),
    ),
  ).toBeDefined();
  expect(model.doGenerateCalls).toHaveLength(0);
  const selected = {
    ...request(),
    revisions: [{ artifactId: "selected", version: 1 }],
  };
  const deletingModel = new MockLanguageModelV4({
    doGenerate: async () => {
      await f.db.$client.unsafe("DELETE FROM artifact WHERE id='selected'");
      return receipt([
        {
          type: "tool-call",
          toolCallId: "read",
          toolName: "readRevision",
          input: '{"artifactId":"selected","version":1}',
        },
      ]);
    },
  });
  expect(
    await rejectionOf(
      startToolRun({
        userId: "alice",
        request: selected,
        env: toolEnv,
        model: deletingModel,
      }),
    ),
  ).toBeDefined();
  expect(deletingModel.doGenerateCalls).toHaveLength(1);
  expect((await store.view("alice", selected.id)).events[0].state).toBe(
    "failed",
  );
});

test("F13 deleting private data during remote work never releases its anonymous hold", async () => {
  const body = request();
  const store = new ToolStore(f.db);
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      await store.remove("alice", body.id);
      return receipt([
        {
          type: "tool-call",
          toolCallId: "late",
          toolName: "arithmetic",
          input: '{"operation":"add","left":2,"right":3}',
        },
      ]);
    },
  });
  expect(
    await rejectionOf(
      startToolRun({ userId: "alice", request: body, env: toolEnv, model }),
    ),
  ).toBeDefined();
  expect(await f.db.$client.unsafe("SELECT * FROM tool_run")).toHaveLength(0);
  expect(await f.db.$client.unsafe("SELECT * FROM tool_call")).toHaveLength(0);
  expect(
    (
      await f.db.$client.unsafe(
        "SELECT state FROM byok_operation WHERE id=$1",
        [body.id],
      )
    )[0].state,
  ).toBe("held");
  expect(await f.db.$client.unsafe("SELECT * FROM tool_step")).toHaveLength(1);
  expect(model.doGenerateCalls).toHaveLength(1);
});

test("F13 tool runs reserve three units against the existing BYOK hourly budget used by basic chat", async () => {
  const { resourceActor } = await import("../lib/byok/config");
  const actor = resourceActor("alice", toolEnv);
  const byok = new ByokStore(f.db);
  const revision = (await byok.credentials("alice"))[0].revision;
  await f.db.$client.unsafe(
    "INSERT INTO byok_operation(id,actor_key,provider,credential_revision,kind,digest,state) SELECT 'f13-seed-'||g,$1,'openrouter',$2,'chat','fixture','released' FROM generate_series(1,28) g",
    [actor, revision],
  );
  const denied = request();
  const model = new MockLanguageModelV4({
    doGenerate: receipt([{ type: "text", text: "5" }], "stop"),
  });
  expect(
    await rejectionOf(
      startToolRun({ userId: "alice", request: denied, env: toolEnv, model }),
    ),
  ).toBeDefined();
  expect(model.doGenerateCalls).toHaveLength(0);
  await f.db.$client.unsafe(
    "DELETE FROM byok_operation WHERE id='f13-seed-28'",
  );
  const allowed = request();
  await startToolRun({
    userId: "alice",
    request: allowed,
    env: toolEnv,
    model,
  });
  expect(
    (
      await f.db.$client.unsafe(
        "SELECT resource_units FROM byok_operation WHERE id=$1",
        [allowed.id],
      )
    )[0].resource_units,
  ).toBe(3);
  expect(
    await rejectionOf(
      byok.reserve({
        id: crypto.randomUUID(),
        userId: "alice",
        provider: "openrouter",
        kind: "chat",
        digest: "fixture",
        env: toolEnv,
      }),
    ),
  ).toMatchObject({ id: "byok_resource_limited" });
  expect(model.doGenerateCalls).toHaveLength(1);
});

test("F13 an oversized complete first prompt releases a reserved operation before provider entry", async () => {
  const body = { ...request(), prompt: "🔥".repeat(4000) };
  const model = new MockLanguageModelV4({
    doGenerate: receipt([{ type: "text", text: "Never entered" }], "stop"),
  });
  expect(
    await rejectionOf(
      startToolRun({ userId: "alice", request: body, env: toolEnv, model }),
    ),
  ).toBeDefined();
  expect(model.doGenerateCalls).toHaveLength(0);
  expect(await f.db.$client.unsafe("SELECT * FROM tool_step")).toHaveLength(0);
  expect(
    (
      await f.db.$client.unsafe(
        "SELECT state FROM byok_operation WHERE id=$1",
        [body.id],
      )
    )[0].state,
  ).toBe("released");
});

test("F13 real OpenRouter SDK wire uses only the owner key, explicit provider, zero retries and joint output allowances", async () => {
  const seen: {
    authorization: string | null;
    body: Record<string, unknown>;
  }[] = [];
  let fail = false;
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      seen.push({
        authorization: new Headers(init?.headers).get("authorization"),
        body,
      });
      if (fail)
        return Response.json(
          { error: { message: `${privateKey} diagnostic` } },
          { status: 500 },
        );
      const tools = seen.length === 1;
      return Response.json({
        id: "f13-wire",
        created: 1,
        model: "fixture/tools",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: tools ? null : "5",
              ...(tools
                ? {
                    tool_calls: [
                      {
                        id: "wire-add",
                        type: "function",
                        function: {
                          name: "arithmetic",
                          arguments: '{"operation":"add","left":2,"right":3}',
                        },
                      },
                    ],
                  }
                : {}),
            },
            finish_reason: tools ? "tool_calls" : "stop",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 12,
          total_tokens: 112,
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      });
    },
    { preconnect: fetch.preconnect },
  );
  const view = await startToolRun({
    userId: "alice",
    request: request(),
    env: toolEnv,
  });
  expect(view.answer).toBe("5");
  expect(seen).toHaveLength(2);
  for (const call of seen) {
    expect(call.authorization).toBe(`Bearer ${privateKey}`);
    expect(call.body.provider).toMatchObject({
      only: ["fixture"],
      allow_fallbacks: false,
      require_parameters: true,
      max_price: { request: 0 },
    });
    expect(call.body.reasoning).toMatchObject({ enabled: false });
  }
  expect(seen.map((s) => s.body.max_tokens)).toEqual([170, 171]);
  expect(JSON.stringify(seen[1].body.messages)).toContain("untrusted");
  expect(
    await f.db.$client.unsafe("SELECT * FROM credit_reservation"),
  ).toHaveLength(0);
  fail = true;
  const before = seen.length;
  expect(
    await rejectionOf(
      startToolRun({ userId: "alice", request: request(), env: toolEnv }),
    ),
  ).toBeDefined();
  expect(seen.length - before).toBe(1);
  expect(
    JSON.stringify((await exportOwnedAccount("alice")).toolData),
  ).not.toContain(privateKey);
});
