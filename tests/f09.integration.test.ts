import { expect, mock, test } from "bun:test";
import { betaFixture, chatBody, env, privateKey } from "./helpers/beta-fixture";
import { rejectionOf } from "./helpers/rejection";

mock.module("server-only", () => ({}));
const context = await import("../app/(chat)/api/context/route");
const { POST: chatPost } = await import("../app/(chat)/api/chat/route");
const { exportOwnedAccount, deleteOwnedAccount } = await import(
  "../lib/actions/account/account"
);
const { ByokStore } = await import("../lib/byok/store");
const { mutateContext, resolveContext } = await import(
  "../lib/context/service"
);
const { boundContext } = await import("../lib/credits/service");
async function terminal(f: Awaited<ReturnType<typeof betaFixture>>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      !(
        await f.db.$client.unsafe(
          "SELECT id FROM credit_reservation WHERE state IN ('reserved','entered')",
        )
      ).length &&
      !(
        await f.db.$client.unsafe(
          "SELECT id FROM chat_run WHERE state='pending'",
        )
      ).length
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("terminal_state_not_reached");
}
async function library(
  f: Awaited<ReturnType<typeof betaFixture>>,
  user = "alice",
) {
  const response = await context.GET(
    await f.request("/api/context", undefined, user),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json();
}
async function mutation(
  f: Awaited<ReturnType<typeof betaFixture>>,
  body: unknown,
  user = "alice",
) {
  return context.POST(await f.request("/api/context", body, user));
}
test("F09 explicit memory CRUD, owned projects and exact selected inference context stay isolated", async () => {
  const f = await betaFixture();
  f.cost(0);
  expect(
    (
      await mutation(f, {
        action: "project.save",
        name: "Owned project",
        instructions: "Project private instruction",
      })
    ).status,
  ).toBe(200);
  let lib = await library(f);
  const projectId = lib.projects[0].id;
  for (const [content, scope] of [
    ["Chosen personal fact", null],
    ["Unselected private fact", null],
    ["Scoped project fact", projectId],
  ] as const)
    expect(
      (await mutation(f, { action: "memory.save", content, projectId: scope }))
        .status,
    ).toBe(200);
  lib = await library(f);
  const chosen = lib.memories.find(
    (m: { content: string }) => m.content === "Chosen personal fact",
  );
  const scoped = lib.memories.find(
    (m: { projectId: string }) => m.projectId === projectId,
  );
  expect((await library(f, "bob")).memories).toEqual([]);
  expect((await library(f, "bob")).projects).toEqual([]);
  expect(
    (await mutation(f, { action: "memory.delete", id: chosen.id }, "bob"))
      .status,
  ).toBe(404);
  expect(
    (
      await mutation(
        f,
        {
          action: "project.save",
          id: projectId,
          name: "Attack",
          instructions: "Attack",
        },
        "bob",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await mutation(
        f,
        { action: "preview", selection: { projectId, memoryIds: [chosen.id] } },
        "bob",
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await mutation(f, {
        action: "preview",
        selection: { projectId: null, memoryIds: [scoped.id] },
      })
    ).status,
  ).toBe(409);
  const preview = await (
    await mutation(f, {
      action: "preview",
      selection: { projectId, memoryIds: [chosen.id, scoped.id] },
    })
  ).json();
  expect(preview.memories.map((m: { id: string }) => m.id)).toEqual([
    chosen.id,
    scoped.id,
  ]);
  expect(preview.project.instructions).toBe("Project private instruction");
  const selection = {
    projectId,
    memoryIds: [chosen.id, scoped.id],
    digest: preview.digest,
  };
  const body = chatBody({ context: selection });
  const response = await chatPost(await f.request("/api/chat", body));
  expect(response.status).toBe(200);
  await response.text();
  await terminal(f);
  const sent = JSON.stringify(f.seen[0].body);
  expect(sent).toContain("Chosen personal fact");
  expect(sent).toContain("Scoped project fact");
  expect(sent).toContain("Project private instruction");
  expect(sent).not.toContain("Unselected private fact");
  expect((await library(f)).memories).toHaveLength(3); // Replies never collect memories.
  expect((await library(f)).chats[0].projectId).toBe(projectId);
  expect((await exportOwnedAccount("alice")).memories).toHaveLength(3);
  expect((await exportOwnedAccount("bob")).projects).toHaveLength(0);
  expect(
    (
      await mutation(f, {
        action: "memory.save",
        id: chosen.id,
        content: "Updated explicit fact",
        projectId: null,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await chatPost(
        await f.request("/api/chat", chatBody({ context: selection })),
      )
    ).status,
  ).toBe(409);
  expect(f.seen).toHaveLength(1);
  expect(
    (await mutation(f, { action: "memory.delete", id: chosen.id })).status,
  ).toBe(200);
  expect(
    (
      await chatPost(
        await f.request("/api/chat", chatBody({ context: selection })),
      )
    ).status,
  ).toBe(409);
  expect(f.seen).toHaveLength(1);
  const fresh = chatBody();
  const freshResponse = await chatPost(await f.request("/api/chat", fresh));
  expect(freshResponse.status).toBe(200);
  await freshResponse.text();
  await terminal(f);
  expect(JSON.stringify(f.seen.at(-1)?.body)).not.toContain(
    "Chosen personal fact",
  );
  expect(JSON.stringify(f.seen.at(-1)?.body)).not.toContain(
    "Updated explicit fact",
  );
  expect(JSON.stringify(f.seen.at(-1)?.body)).not.toContain(
    "Project private instruction",
  );
  expect(
    (
      await chatPost(
        await f.request(
          "/api/chat",
          chatBody({ id: body.id, branchId: body.id }),
        ),
      )
    ).status,
  ).toBe(409);
  expect(
    (await mutation(f, { action: "project.delete", id: projectId })).status,
  ).toBe(200);
  lib = await library(f);
  expect(lib.projects).toHaveLength(0);
  expect(lib.memories).toHaveLength(1);
  expect(
    lib.chats.every((c: { projectId: string | null }) => c.projectId === null),
  ).toBe(true);
  expect(
    await rejectionOf(
      f.db.$client.unsafe(
        "INSERT INTO memory(id,user_id,project_id,content) VALUES ('invalid','bob','missing','invalid')",
      ),
    ),
  ).toMatchObject({ code: "23503" });
  await deleteOwnedAccount("alice");
  expect(await f.db.$client.unsafe("SELECT id FROM memory")).toHaveLength(0);
  expect(await f.db.$client.unsafe("SELECT id FROM project")).toHaveLength(0);
  expect(
    (await f.db.$client.unsafe("SELECT id FROM credit_reservation")).length,
  ).toBeGreaterThan(0);
});

test("F09 temporary SDK exchanges reserve spend but create no durable content, history, title or memory", async () => {
  const f = await betaFixture();
  f.cost(0);
  const sensitive = "TEMPORARY_SECRET_CONTEXT_9e5289";
  for (let i = 0; i < 2; i++) {
    const body = chatBody({
      temporary: true,
      message: {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: sensitive }],
      },
      transientMessages: i
        ? [
            { role: "user", content: "Earlier ephemeral question" },
            { role: "assistant", content: "Earlier ephemeral answer" },
          ]
        : [],
    });
    const response = await chatPost(await f.request("/api/chat", body));
    expect(response.status).toBe(200);
    expect(response.headers.has("x-chat-branch")).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("Local beta fixture answer");
    await terminal(f);
  }
  expect(JSON.stringify(f.seen.at(-1)?.body)).toContain(
    "Earlier ephemeral answer",
  );
  for (const table of [
    "chat",
    "chat_message",
    "chat_branch",
    "chat_run",
    "usage_record",
    "memory",
    "project",
  ])
    expect(await f.db.$client.unsafe(`SELECT * FROM ${table}`)).toHaveLength(0);
  const exported = await exportOwnedAccount("alice");
  expect(exported.chats).toEqual([]);
  expect(exported.messages).toEqual([]);
  expect(exported.branches).toEqual([]);
  expect(exported.runs).toEqual([]);
  expect(exported.memories).toEqual([]);
  const audit =
    JSON.stringify(
      await f.db.$client.unsafe("SELECT * FROM credit_reservation"),
    ) +
    JSON.stringify(await f.db.$client.unsafe("SELECT * FROM credit_ledger"));
  expect(audit).not.toContain(sensitive);
  expect(audit).not.toContain("Earlier ephemeral");
  expect(audit).not.toContain("f08-response");
  expect(audit).not.toContain("Local beta fixture answer");
  expect(
    await f.db.$client.unsafe("SELECT id FROM credit_reservation"),
  ).toHaveLength(2);
});

test("F09 temporary requests cannot borrow saved branches or bypass funding, and transient history is temporary-only", async () => {
  const f = await betaFixture();
  f.cost(0);
  const saved = chatBody();
  const response = await chatPost(await f.request("/api/chat", saved));
  await response.text();
  await terminal(f);
  const attempts = [
    chatBody({ temporary: true, id: saved.id, branchId: saved.id }),
    chatBody({
      temporary: true,
      action: "regenerate",
      anchorId: saved.message.id,
    }),
    chatBody({ temporary: true, branchId: saved.id }),
    chatBody({
      transientMessages: [
        { role: "assistant", content: "Caller injected history" },
      ],
    }),
  ];
  for (const body of attempts)
    expect(
      (await chatPost(await f.request("/api/chat", body))).status,
    ).toBeGreaterThanOrEqual(400);
  expect(f.seen).toHaveLength(1);
  process.env.FUNDED_KILL_SWITCH = "1";
  expect(
    (
      await chatPost(
        await f.request("/api/chat", chatBody({ temporary: true })),
      )
    ).status,
  ).toBe(503);
  expect(f.seen).toHaveLength(1);
  expect(await f.db.$client.unsafe("SELECT id FROM chat")).toHaveLength(1);
  expect(
    await f.db.$client.unsafe("SELECT id FROM credit_reservation"),
  ).toHaveLength(1);
});

test("F09 temporary BYOK uses owned key and resource caps without platform spend or persistence", async () => {
  const f = await betaFixture();
  await new ByokStore(f.db).save("alice", "openrouter", privateKey, env, null);
  const response = await chatPost(
    await f.request(
      "/api/chat",
      chatBody({
        temporary: true,
        funding: "openrouter",
        model: "f08-private",
      }),
    ),
  );
  expect(response.status).toBe(200);
  await response.text();
  for (let n = 0; n < 100; n++) {
    if (
      (await f.db.$client.unsafe("SELECT state FROM byok_operation"))[0]
        ?.state === "complete"
    )
      break;
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(f.seen[0].authorization).toBe(`Bearer ${privateKey}`);
  expect(
    await f.db.$client.unsafe("SELECT id FROM credit_reservation"),
  ).toHaveLength(0);
  expect(await f.db.$client.unsafe("SELECT id FROM chat")).toHaveLength(0);
  expect(await f.db.$client.unsafe("SELECT id FROM chat_message")).toHaveLength(
    0,
  );
  expect(
    await f.db.$client.unsafe("SELECT id FROM byok_operation"),
  ).toHaveLength(1);
  const before = JSON.stringify(
    await f.db.$client.unsafe("SELECT * FROM byok_operation"),
  );
  expect(before).not.toContain(privateKey);
  expect(before).not.toContain("Local beta acceptance prompt");
  await deleteOwnedAccount("alice");
  expect(
    await f.db.$client.unsafe("SELECT id FROM byok_operation"),
  ).toHaveLength(1);
});

test("F09 context bounds include exact instructions, deny oversized selections and recheck revocation before provider entry", async () => {
  const f = await betaFixture();
  const instructions = "x".repeat(4400);
  const bounded = boundContext(
    Array.from({ length: 12 }, (_, i) => ({
      role: i === 11 ? ("user" as const) : ("assistant" as const),
      content: "z".repeat(1600),
    })),
    false,
    instructions,
  );
  expect(
    new TextEncoder().encode(JSON.stringify([instructions, bounded])).length,
  ).toBeLessThanOrEqual(12000);
  expect(bounded.at(-1)?.role).toBe("user");
  expect(bounded.length).toBeLessThan(12);
  expect(
    (
      await mutation(f, {
        action: "memory.save",
        content: "界".repeat(1000),
        projectId: null,
      })
    ).status,
  ).toBe(400);
  for (let i = 0; i < 5; i++)
    await mutateContext("alice", {
      action: "memory.save",
      content: String(i) + "a".repeat(999),
    });
  const lib = await library(f);
  expect(
    (
      await mutation(f, {
        action: "preview",
        selection: { memoryIds: lib.memories.map((m: { id: string }) => m.id) },
      })
    ).status,
  ).toBe(400);
  const id = lib.memories[0].id;
  const preview = await resolveContext(
    "alice",
    { projectId: null, memoryIds: [id] },
    false,
  );
  const { startFundedStream } = await import("../lib/credits/service");
  const { CreditStore, actorFor } = await import("../lib/credits/store");
  let calls = 0;
  const selection = {
    projectId: null,
    memoryIds: [id],
    digest: preview.digest,
  };
  expect(
    await rejectionOf(
      startFundedStream({
        env,
        actor: actorFor("user", "alice", env.CREDIT_ACTOR_SECRET),
        idempotencyKey: crypto.randomUUID(),
        turns: [{ role: "user", content: "Bounded request" }],
        instructions: preview.instructions,
        store: new CreditStore(f.db),
        beforeProvider: async () => {
          await mutateContext("alice", { action: "memory.delete", id });
          await resolveContext("alice", selection);
        },
        provider: () => {
          calls++;
          throw new Error("must not enter");
        },
      }),
    ),
  ).toMatchObject({ id: "context_changed" });
  expect(calls).toBe(0);
  expect(
    (
      await f.db.$client.unsafe<
        { state: string; charged_microdollars: number }[]
      >("SELECT state,charged_microdollars FROM credit_reservation")
    )[0],
  ).toEqual({ state: "released", charged_microdollars: 0 });
});

test("F09 temporary cancellation leaves a durable unknown hold without content", async () => {
  const f = await betaFixture();
  f.slow();
  const abort = new AbortController();
  const body = chatBody({ temporary: true });
  const response = await chatPost(
    new Request(`${env.BETTER_AUTH_URL}/api/chat`, {
      method: "POST",
      headers: await f.headers(),
      body: JSON.stringify(body),
      signal: abort.signal,
    }),
  );
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("missing_stream");
  let text = "";
  while (!text.includes("text-delta")) {
    const part = await reader.read();
    if (part.done) throw new Error("missing_partial");
    text += new TextDecoder().decode(part.value);
  }
  abort.abort();
  while (!(await reader.read()).done) {}
  reader.releaseLock();
  for (let n = 0; n < 100; n++) {
    if (
      (await f.db.$client.unsafe("SELECT state FROM credit_reservation"))[0]
        ?.state === "held"
    )
      break;
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(
    (
      await f.db.$client.unsafe<
        { state: string; charged_microdollars: number }[]
      >("SELECT state,charged_microdollars FROM credit_reservation")
    )[0],
  ).toEqual({ state: "held", charged_microdollars: 100000 });
  for (const table of ["chat", "chat_message", "chat_branch", "chat_run"])
    expect(await f.db.$client.unsafe(`SELECT id FROM ${table}`)).toHaveLength(
      0,
    );
});

test("F09 context API requires invited signed access and same origin, and project ownership survives account cascade", async () => {
  const f = await betaFixture();
  expect(
    (await context.GET(new Request(`${env.BETTER_AUTH_URL}/api/context`)))
      .status,
  ).toBe(401);
  expect(
    (await context.GET(await f.request("/api/context", undefined, "outsider")))
      .status,
  ).toBe(403);
  const headers = await f.headers();
  headers.set("origin", "https://foreign.invalid");
  expect(
    (
      await context.POST(
        new Request(`${env.BETTER_AUTH_URL}/api/context`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            action: "memory.save",
            content: "Must not save",
          }),
        }),
      )
    ).status,
  ).toBe(403);
  expect((await library(f)).memories).toHaveLength(0);
  await mutateContext("alice", {
    action: "project.save",
    name: "Account cascade",
    instructions: "Private project",
  });
  const projectId = (await library(f)).projects[0].id;
  expect(
    await rejectionOf(
      f.db.$client.unsafe(
        "INSERT INTO memory(id,user_id,project_id,content) VALUES ('foreign','bob',$1,'Must not cross owners')",
        [projectId],
      ),
    ),
  ).toMatchObject({ code: "23503" });
  await mutateContext("alice", {
    action: "memory.save",
    content: "Private memory",
    projectId,
  });
  const selected = await resolveContext(
    "alice",
    { projectId, memoryIds: [] },
    false,
  );
  const body = chatBody({
    context: { projectId, memoryIds: [], digest: selected.digest },
  });
  const response = await chatPost(await f.request("/api/chat", body));
  expect(response.status).toBe(200);
  await response.text();
  await terminal(f);
  await deleteOwnedAccount("alice");
  for (const table of [
    "memory",
    "project",
    "chat",
    "chat_message",
    "chat_branch",
    "chat_run",
  ])
    expect(await f.db.$client.unsafe(`SELECT id FROM ${table}`)).toHaveLength(
      0,
    );
  const rls = await f.db.$client.unsafe(
    "SELECT relrowsecurity FROM pg_class WHERE relname IN ('project','memory')",
  );
  expect(rls).toHaveLength(2);
  expect(rls.every((row) => row.relrowsecurity)).toBe(true);
  expect(
    await f.db.$client.unsafe("SELECT id FROM credit_reservation"),
  ).toHaveLength(1);
});

test("F09 temporary spend counts toward the same saved-chat daily allowance and BYOK rechecks selected context", async () => {
  const f = await betaFixture();
  for (let index = 0; index < 5; index++) {
    const response = await chatPost(
      await f.request("/api/chat", chatBody({ temporary: true })),
    );
    expect(response.status).toBe(200);
    await response.text();
    await terminal(f);
  }
  expect(
    (
      await chatPost(
        await f.request("/api/chat", chatBody({ temporary: true })),
      )
    ).status,
  ).toBe(429);
  expect(f.seen).toHaveLength(5);
  expect(await f.db.$client.unsafe("SELECT id FROM chat")).toHaveLength(0);
  await new ByokStore(f.db).save("alice", "openrouter", privateKey, env, null);
  await mutateContext("alice", {
    action: "memory.save",
    content: "Revoked before BYOK entry",
  });
  const id = (await library(f)).memories[0].id;
  const preview = await resolveContext(
    "alice",
    { projectId: null, memoryIds: [id] },
    false,
  );
  const { startByokStream } = await import("../lib/byok/service");
  expect(
    await rejectionOf(
      startByokStream({
        userId: "alice",
        provider: "openrouter",
        model: "f08-private",
        idempotencyKey: crypto.randomUUID(),
        turns: [{ role: "user", content: "Bounded private request" }],
        env,
        instructions: preview.instructions,
        beforeProvider: async () => {
          await mutateContext("alice", { action: "memory.delete", id });
          await resolveContext("alice", {
            projectId: null,
            memoryIds: [id],
            digest: preview.digest,
          });
        },
      }),
    ),
  ).toMatchObject({ id: "context_changed" });
  expect(f.seen).toHaveLength(5);
  expect(
    (await f.db.$client.unsafe("SELECT state FROM byok_operation"))[0]?.state,
  ).toBe("released");
  expect(
    await f.db.$client.unsafe("SELECT id FROM credit_reservation"),
  ).toHaveLength(5);
});
