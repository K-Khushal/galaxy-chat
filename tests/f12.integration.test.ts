import { expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sampleChart } from "../lib/artifacts/chart-spec";
import { artifactLimits } from "../lib/artifacts/contract";
import { betaFixture, env, secret } from "./helpers/beta-fixture";
import { rejectionOf } from "./helpers/rejection";

mock.module("server-only", () => ({}));
const { GET, POST } = await import("../app/(chat)/api/artifacts/route");
const { readArtifact, mutateArtifact } = await import(
  "../lib/artifacts/service"
);
const { exportOwnedAccount, deleteOwnedAccount } = await import(
  "../lib/actions/account/account"
);
const source = JSON.stringify(sampleChart("scatter"), null, 2);
const create = {
  action: "create" as const,
  chatId: "chart-chat",
  messageId: "chart-answer",
  kind: "chart" as const,
  title: 'Response "chart"',
};
async function fixture() {
  const f = await betaFixture();
  await f.db.$client
    .unsafe(
      `INSERT INTO chat(id,user_id,title) VALUES ('chart-chat','alice','Chart'),('bob-chart','bob','Bob'); INSERT INTO chat_message(id,chat_id,user_id,role,parts,attachments) VALUES ('chart-answer','chart-chat','alice','assistant','[]','[]'),('bad-chart','chart-chat','alice','assistant','[{"type":"text","text":"{}"}]','[]'),('user-chart','chart-chat','alice','user','[]','[]'),('bob-answer','bob-chart','bob','assistant','[]','[]')`,
    )
    .simple();
  await f.db.$client.unsafe(
    "UPDATE chat_message SET parts=$1::jsonb WHERE id IN ('chart-answer','user-chart','bob-answer')",
    [JSON.stringify([{ type: "text", text: `\`\`\`json\n${source}\n\`\`\`` }])],
  );
  return f;
}

test("F12 real signed route creates owned chart source, CAS saves and immutable restores, exports saved JSON/SVG and keeps account export/delete", async () => {
  const f = await fixture();
  const response = await POST(await f.request("/api/artifacts", create));
  expect(response.status).toBe(200);
  const { id } = await response.json();
  expect(await readArtifact("alice", id)).toMatchObject({
    kind: "chart",
    messageId: "chart-answer",
    content: source,
    version: 1,
  });
  const nextSource = JSON.stringify(sampleChart("line"));
  const race = await Promise.allSettled(
    [nextSource, JSON.stringify(sampleChart("area"))].map((content) =>
      mutateArtifact("alice", {
        action: "save",
        id,
        expectedVersion: 1,
        title: "Changed",
        content,
      }),
    ),
  );
  expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(
    1,
  );
  expect(race.find((result) => result.status === "rejected")).toMatchObject({
    reason: { id: "artifact_conflict" },
  });
  await mutateArtifact("alice", {
    action: "restore",
    id,
    expectedVersion: 2,
    version: 1,
  });
  const restored = await readArtifact("alice", id);
  expect(restored.version).toBe(3);
  expect(restored.content).toBe(source);
  expect(restored.revisions[0].restoredFrom).toBe(1);
  expect(restored.revisions).toHaveLength(3);
  const json = await GET(
    await f.request(`/api/artifacts?id=${id}&download=source`),
  );
  expect(json.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  expect(json.headers.get("content-disposition")).toBe(
    'attachment; filename="Response-chart.chart.json"',
  );
  expect(await json.text()).toBe(source);
  const svg = await GET(
    await f.request(`/api/artifacts?id=${id}&download=svg`),
  );
  expect(svg.status).toBe(200);
  expect(svg.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
  expect(svg.headers.get("content-disposition")).toBe(
    'attachment; filename="Response-chart.svg"',
  );
  expect(svg.headers.get("content-security-policy")).toBe(
    "default-src 'none'; sandbox",
  );
  expect(svg.headers.get("cache-control")).toBe("private, no-store");
  expect(svg.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await svg.text()).toContain("Response time and satisfaction");
  expect(
    await rejectionOf(
      f.db.$client.unsafe("UPDATE artifact_revision SET content='{}'").simple(),
    ),
  ).toMatchObject({ message: expect.stringContaining("immutable") });
  expect((await readArtifact("alice", id)).content).toBe(source);
  const exported = await exportOwnedAccount("alice");
  expect(exported.artifacts.map((row) => row.kind)).toEqual(["chart"]);
  expect(exported.artifactRevisions).toHaveLength(3);
  await deleteOwnedAccount("alice");
  expect(
    await f.db.$client.unsafe("SELECT * FROM artifact_revision"),
  ).toHaveLength(0);
  expect(f.seen).toHaveLength(0);
});

test("F12 chart route denies every cross-owner operation, unsigned/uninvited/guest/temporary origins and forged source or kind", async () => {
  const f = await fixture(),
    { id } = await mutateArtifact("alice", create);
  for (const query of [
    `?id=${id}`,
    `?id=${id}&download=source`,
    `?id=${id}&download=svg`,
    "?chatId=chart-chat",
  ])
    expect(
      (await GET(await f.request(`/api/artifacts${query}`, undefined, "bob")))
        .status,
    ).toBe(404);
  for (const input of [
    create,
    {
      action: "save",
      id,
      expectedVersion: 1,
      title: "Stolen",
      content: source,
    },
    { action: "restore", id, expectedVersion: 1, version: 1 },
    { action: "delete", id },
  ])
    expect(
      (await POST(await f.request("/api/artifacts", input, "bob"))).status,
    ).toBe(404);
  for (const input of [
    { ...create, messageId: "user-chart" },
    { ...create, messageId: "bob-answer" },
    { ...create, chatId: "temporary-chat", messageId: "ephemeral" },
  ])
    expect((await POST(await f.request("/api/artifacts", input))).status).toBe(
      404,
    );
  for (const input of [
    { ...create, content: source },
    { ...create, temporary: true },
    {
      action: "save",
      id,
      expectedVersion: 1,
      title: "Forged",
      kind: "markdown",
      content: "{}",
    },
  ])
    expect((await POST(await f.request("/api/artifacts", input))).status).toBe(
      400,
    );
  expect(
    (
      await GET(
        new Request(
          `https://galaxy.example/api/artifacts?id=${id}&download=svg`,
        ),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await GET(
        await f.request(`/api/artifacts?id=${id}`, undefined, "outsider"),
      )
    ).status,
  ).toBe(403);
  const { signedGuest } = await import("../lib/credits/guest");
  expect(
    (
      await POST(
        new Request(`${env.BETTER_AUTH_URL}/api/artifacts`, {
          method: "POST",
          headers: {
            origin: env.BETTER_AUTH_URL,
            "content-type": "application/json",
            cookie: `__Host-galaxy-guest=${signedGuest(secret)}`,
          },
          body: JSON.stringify(create),
        }),
      )
    ).status,
  ).toBe(401);
  const wrongOrigin = await f.request("/api/artifacts", create);
  wrongOrigin.headers.set("origin", "https://evil.invalid");
  expect((await POST(wrongOrigin)).status).toBe(403);
  expect((await readArtifact("alice", id)).version).toBe(1);
  expect(f.seen).toHaveLength(0);
});

test("F12 malformed create/save/restore/export and shared storage/revision quotas fail atomically; deletion frees bytes", async () => {
  const f = await fixture();
  expect(
    (
      await POST(
        await f.request("/api/artifacts", {
          ...create,
          messageId: "bad-chart",
        }),
      )
    ).status,
  ).toBe(400);
  const { id } = await mutateArtifact("alice", create);
  for (const content of [
    "{}",
    JSON.stringify({ ...sampleChart(), formatter: "alert(1)" }),
    "😀".repeat(32769),
  ]) {
    expect(
      (
        await POST(
          await f.request("/api/artifacts", {
            action: "save",
            id,
            expectedVersion: 1,
            title: "Bad",
            content,
          }),
        )
      ).status,
    ).toBe(400);
    expect((await readArtifact("alice", id)).version).toBe(1);
    expect((await readArtifact("alice", id)).revisions).toHaveLength(1);
  }
  // A legacy malformed historical row is refused on restore/export, even if DB
  // maintenance inserted it. No update or immutability bypass is performed.
  await f.db.$client.unsafe(
    "INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) VALUES ($1,'alice',2,'Malformed','{}')",
    [id],
  );
  expect(
    await rejectionOf(
      mutateArtifact("alice", {
        action: "restore",
        id,
        expectedVersion: 1,
        version: 2,
      }),
    ),
  ).toMatchObject({ id: "invalid_artifact" });
  expect((await readArtifact("alice", id)).version).toBe(1);
  await f.db.$client.unsafe("UPDATE artifact SET head=2 WHERE id=$1", [id]);
  for (const download of ["source", "svg"])
    expect(
      (
        await GET(
          await f.request(`/api/artifacts?id=${id}&download=${download}`),
        )
      ).status,
    ).toBe(400);
  await mutateArtifact("alice", { action: "delete", id });
  await f.db.$client.begin(async (tx) => {
    await tx
      .unsafe(
        `INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES ('full-a','alice','chart-chat','chart-answer','html',32),('full-b','alice','chart-chat','chart-answer','html',32); INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) SELECT a,'alice',n,'Seed',repeat('x',131072) FROM unnest(ARRAY['full-a','full-b']) a CROSS JOIN generate_series(1,32) n`,
      )
      .simple();
  });
  expect(await rejectionOf(mutateArtifact("alice", create))).toMatchObject({
    id: "artifact_storage_limit",
  });
  expect(await f.db.$client.unsafe("SELECT id FROM artifact")).toHaveLength(2);
  await mutateArtifact("alice", { action: "delete", id: "full-a" });
  const created = await mutateArtifact("alice", create);
  for (let version = 1; version < artifactLimits.revisions; version++)
    await mutateArtifact("alice", {
      action: "save",
      id: created.id,
      expectedVersion: version,
      title: "Revision",
      content: source,
    });
  expect(
    await rejectionOf(
      mutateArtifact("alice", {
        action: "restore",
        id: created.id,
        expectedVersion: 40,
        version: 1,
      }),
    ),
  ).toMatchObject({ id: "artifact_revision_limit" });
  await f.db.$client.unsafe("DELETE FROM chat WHERE id='chart-chat'");
  expect(
    await f.db.$client.unsafe("SELECT * FROM artifact_revision"),
  ).toHaveLength(0);
  expect(f.seen).toHaveLength(0);
});

test("F12 migration 0009 upgrades a populated F11 schema, preserves histories/guards and allows only the new chart kind", async () => {
  const db = await PGlite.create();
  try {
    for (const name of readdirSync("drizzle")
      .filter((name) => name.endsWith(".sql") && name < "0009")
      .sort())
      await db.exec(readFileSync(`drizzle/${name}`, "utf8"));
    await db.exec(
      `INSERT INTO "user"(id,name,email) VALUES ('owner','Owner','owner@example.invalid'); INSERT INTO chat(id,user_id,title) VALUES ('chat','owner','Chart'); INSERT INTO chat_message(id,chat_id,user_id,role,parts,attachments) VALUES ('message','chat','owner','assistant','[]','[]'); BEGIN; INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES ('old','owner','chat','message','markdown',1); INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) VALUES ('old','owner',1,'Old','# Old'); COMMIT;`,
    );
    await db.exec(readFileSync("drizzle/0009_chart_artifacts.sql", "utf8"));
    expect(
      (
        await db.query(
          "SELECT content FROM artifact_revision WHERE artifact_id='old'",
        )
      ).rows,
    ).toEqual([{ content: "# Old" }]);
    await db.exec(
      `BEGIN; INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES ('new','owner','chat','message','chart',1); INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) VALUES ('new','owner',1,'New','{}'); COMMIT;`,
    );
    expect(
      await rejectionOf(
        db.exec(
          "UPDATE artifact_revision SET content='Changed' WHERE artifact_id='old'",
        ),
      ),
    ).toMatchObject({ message: expect.stringContaining("immutable") });
    expect(
      await rejectionOf(
        db.exec("UPDATE artifact SET kind='html' WHERE id='new'"),
      ),
    ).toMatchObject({ message: expect.stringContaining("immutable") });
    expect(
      await rejectionOf(
        db.exec(
          "INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES ('bad','owner','chat','message','javascript',1)",
        ),
      ),
    ).toMatchObject({ code: "23514" });
  } finally {
    await db.close();
  }
});
