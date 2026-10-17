import { expect, mock, test } from "bun:test";

import { artifactLimits } from "../lib/artifacts/contract";
import { betaFixture, chatBody, env, secret } from "./helpers/beta-fixture";
import { rejectionOf } from "./helpers/rejection";

mock.module("server-only", () => ({}));
const { GET, POST } = await import("../app/(chat)/api/artifacts/route");
const { deleteOwnedAccount, exportOwnedAccount } = await import(
  "../lib/actions/account/account"
);
const { mutateArtifact, readArtifact } = await import(
  "../lib/artifacts/service"
);
async function fixture() {
  const f = await betaFixture();
  await f.db.$client
    .unsafe(
      `INSERT INTO chat(id,user_id,title) VALUES ('alice-chat','alice','Launch notes'),('bob-chat','bob','Private'); INSERT INTO chat_message(id,chat_id,user_id,role,parts,attachments) VALUES ('alice-answer','alice-chat','alice','assistant','[{"type":"text","text":"# Owned source\\n\\nLaunch details"}]','[]'),('alice-prompt','alice-chat','alice','user','[{"type":"text","text":"Prompt"}]','[]'),('bob-answer','bob-chat','bob','assistant','[{"type":"text","text":"Bob private answer"}]','[]')`,
    )
    .simple();
  return f;
}
const creation = {
  action: "create" as const,
  chatId: "alice-chat",
  messageId: "alice-answer",
  kind: "markdown" as const,
  title: "Launch notes",
};

test("F11 real route creates from server-owned message, CAS serializes saves, restores immutable history, and downloads text", async () => {
  const f = await fixture();
  const response = await POST(await f.request("/api/artifacts", creation));
  expect(response.status).toBe(200);
  const { id } = await response.json();
  const original = await readArtifact("alice", id);
  expect(original).toMatchObject({
    content: "# Owned source\n\nLaunch details",
    messageId: "alice-answer",
    chatId: "alice-chat",
    version: 1,
  });
  const race = await Promise.allSettled([
    mutateArtifact("alice", {
      action: "save",
      id,
      expectedVersion: 1,
      title: "Changed",
      content: "<script>untrusted()</script>",
    }),
    mutateArtifact("alice", {
      action: "save",
      id,
      expectedVersion: 1,
      title: "Other",
      content: "Another editor",
    }),
  ]);
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
  expect(restored.content).toBe(original.content);
  expect(restored.revisions.map((revision) => revision.version)).toEqual([
    3, 2, 1,
  ]);
  expect(restored.revisions[0].restoredFrom).toBe(1);
  expect(
    await rejectionOf(
      f.db.$client
        .unsafe("UPDATE artifact_revision SET content='tampered'")
        .simple(),
    ),
  ).toMatchObject({
    message: expect.stringContaining("artifact revisions are immutable"),
  });
  expect((await readArtifact("alice", id)).content).toBe(original.content);
  expect(
    await rejectionOf(
      f.db.$client.unsafe("DELETE FROM artifact_revision").simple(),
    ),
  ).toMatchObject({
    message: expect.stringContaining("delete the artifact instead"),
  });
  expect((await readArtifact("alice", id)).revisions).toHaveLength(3);
  expect(
    await rejectionOf(
      f.db.$client
        .unsafe("UPDATE artifact SET message_id='alice-prompt'")
        .simple(),
    ),
  ).toMatchObject({
    message: expect.stringContaining("artifact origin is immutable"),
  });
  const download = await GET(
    await f.request(`/api/artifacts?id=${id}&download=source`),
  );
  expect(download.headers.get("content-type")).toBe(
    "text/plain; charset=utf-8",
  );
  expect(download.headers.get("content-disposition")).toBe(
    'attachment; filename="Launch-notes.md"',
  );
  expect(download.headers.get("content-security-policy")).toContain("sandbox");
  expect(download.headers.get("cache-control")).toContain("no-store");
  expect(await download.text()).toBe(original.content);
  expect(f.seen).toHaveLength(0);
});

test("F11 every resource operation rejects other owners, guest/temp IDs, bad origin, unsigned sessions, and forged source", async () => {
  const f = await fixture();
  const { id } = await mutateArtifact("alice", creation);
  for (const query of [
    `?id=${id}`,
    `?id=${id}&download=source`,
    "?chatId=alice-chat",
  ])
    expect(
      (await GET(await f.request(`/api/artifacts${query}`, undefined, "bob")))
        .status,
    ).toBe(404);
  for (const input of [
    creation,
    { action: "save", id, expectedVersion: 1, title: "Stolen", content: "No" },
    { action: "restore", id, expectedVersion: 1, version: 1 },
    { action: "delete", id },
  ])
    expect(
      (await POST(await f.request("/api/artifacts", input, "bob"))).status,
    ).toBe(404);
  for (const input of [
    { ...creation, messageId: "alice-prompt" },
    { ...creation, messageId: "bob-answer" },
    {
      ...creation,
      chatId: "temporary-not-persisted",
      messageId: "local-assistant",
    },
  ])
    expect((await POST(await f.request("/api/artifacts", input))).status).toBe(
      404,
    );
  expect(
    (
      await POST(
        await f.request("/api/artifacts", {
          ...creation,
          content: "Forged assistant source",
        }),
      )
    ).status,
  ).toBe(400);
  const wrongOrigin = await f.request("/api/artifacts", creation);
  wrongOrigin.headers.set("origin", "https://attacker.invalid");
  expect((await POST(wrongOrigin)).status).toBe(403);
  expect(
    (await GET(new Request(`https://galaxy.example/api/artifacts?id=${id}`)))
      .status,
  ).toBe(401);
  expect(
    (
      await GET(
        await f.request(`/api/artifacts?id=${id}`, undefined, "outsider"),
      )
    ).status,
  ).toBe(403);
  expect(
    await rejectionOf(
      f.db.$client.unsafe(
        `INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES ('forged','bob','alice-chat','alice-answer','html',1)`,
      ),
    ),
  ).toMatchObject({ code: "23503" });
  expect((await readArtifact("alice", id)).version).toBe(1);
});

test("F11 bounds UTF-8, request streams and revision history without overwriting an old revision", async () => {
  const f = await fixture();
  const { id } = await mutateArtifact("alice", creation);
  for (const content of ["😀".repeat(32769), "\0"])
    expect(
      (
        await POST(
          await f.request("/api/artifacts", {
            action: "save",
            id,
            expectedVersion: 1,
            title: "Too long",
            content,
          }),
        )
      ).status,
    ).toBe(400);
  const response = await POST(
    new Request("https://galaxy.example/api/artifacts", {
      method: "POST",
      headers: await f.headers(),
      body: " ".repeat(artifactLimits.requestBytes + 1),
    }),
  );
  expect(response.status).toBe(413);
  await mutateArtifact("alice", {
    action: "save",
    id,
    expectedVersion: 1,
    title: 'Unsafe "/../ title\r\n<script>',
    content: "😀".repeat(32768),
  });
  expect(
    new TextEncoder().encode((await readArtifact("alice", id)).content)
      .byteLength,
  ).toBe(131072);
  for (let version = 2; version < artifactLimits.revisions; version++)
    await mutateArtifact("alice", {
      action: "save",
      id,
      expectedVersion: version,
      title: "Revision",
      content: `Revision ${version + 1}`,
    });
  expect(
    await rejectionOf(
      mutateArtifact("alice", {
        action: "restore",
        id,
        expectedVersion: 40,
        version: 1,
      }),
    ),
  ).toMatchObject({ id: "artifact_revision_limit" });
  expect((await readArtifact("alice", id)).revisions).toHaveLength(40);
  expect(
    (
      await f.db.$client.unsafe(
        `SELECT content FROM artifact_revision WHERE artifact_id=$1 AND version=1`,
        [id],
      )
    )[0].content,
  ).toBe("# Owned source\n\nLaunch details");
});

test("F11 owner-wide artifact count and byte quotas reject atomically and deletion frees space", async () => {
  const f = await fixture();
  await f.db.$client.begin(async (tx) => {
    await tx
      .unsafe(
        `INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) SELECT 'count-'||n,'alice','alice-chat','alice-answer','markdown',1 FROM generate_series(1,50) n; INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) SELECT 'count-'||n,'alice',1,'Seed','Small' FROM generate_series(1,50) n`,
      )
      .simple();
  });
  expect(await rejectionOf(mutateArtifact("alice", creation))).toMatchObject({
    id: "artifact_limit",
  });
  await mutateArtifact("alice", { action: "delete", id: "count-50" });
  const created = await mutateArtifact("alice", creation);
  expect(created.id).toBeDefined();
  await f.db.$client.unsafe(`DELETE FROM artifact WHERE user_id='alice'`);
  await f.db.$client.begin(async (tx) => {
    await tx
      .unsafe(
        `INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES ('bytes-a','alice','alice-chat','alice-answer','html',32),('bytes-b','alice','alice-chat','alice-answer','html',32); INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) SELECT a,'alice',n,'Seed',repeat('x',131072) FROM unnest(ARRAY['bytes-a','bytes-b']) a CROSS JOIN generate_series(1,32) n`,
      )
      .simple();
  });
  expect(await rejectionOf(mutateArtifact("alice", creation))).toMatchObject({
    id: "artifact_storage_limit",
  });
  expect(
    await rejectionOf(
      mutateArtifact("alice", {
        action: "save",
        id: "bytes-a",
        expectedVersion: 32,
        title: "New",
        content: "1",
      }),
    ),
  ).toMatchObject({ id: "artifact_storage_limit" });
  expect((await readArtifact("alice", "bytes-a")).version).toBe(32);
  expect(
    await f.db.$client.unsafe(`SELECT id FROM artifact WHERE user_id='alice'`),
  ).toHaveLength(2);
  await mutateArtifact("alice", { action: "delete", id: "bytes-a" });
  expect((await mutateArtifact("alice", creation)).id).toBeDefined();
});

test("F11 account export includes owned source and revisions; account/chat cascades remove them and preserve audit leases", async () => {
  const f = await fixture();
  const alice = await mutateArtifact("alice", {
    ...creation,
    kind: "html",
    title: '../../secret"\r\n<script>',
  });
  const bob = await mutateArtifact("bob", {
    ...creation,
    chatId: "bob-chat",
    messageId: "bob-answer",
  });
  await f.db.$client.unsafe(
    `INSERT INTO byok_operation(id,actor_key,provider,credential_revision,kind,digest,state) VALUES ('audit','anonymous-actor','openrouter','revision','chat','digest','held')`,
  );
  const exported = await exportOwnedAccount("alice");
  expect(exported.artifacts.map((item) => item.id)).toEqual([alice.id]);
  expect(exported.artifactRevisions).toHaveLength(1);
  expect(exported.artifactRevisions[0].content).toBe(
    "# Owned source\n\nLaunch details",
  );
  const download = await GET(
    await f.request(`/api/artifacts?id=${alice.id}&download=source`),
  );
  expect(download.headers.get("content-disposition")).toBe(
    'attachment; filename="secret-script.html.txt"',
  );
  await deleteOwnedAccount("alice");
  expect(
    await f.db.$client.unsafe(
      `SELECT artifact_id FROM artifact_revision WHERE user_id='alice'`,
    ),
  ).toHaveLength(0);
  expect(
    await f.db.$client.unsafe(`SELECT id FROM artifact WHERE user_id='alice'`),
  ).toHaveLength(0);
  expect(
    await f.db.$client.unsafe(`SELECT id FROM byok_operation`),
  ).toHaveLength(1);
  expect((await readArtifact("bob", bob.id)).content).toBe(
    "Bob private answer",
  );
  await f.db.$client.unsafe(`DELETE FROM chat WHERE id='bob-chat'`);
  expect(
    await f.db.$client.unsafe(`SELECT artifact_id FROM artifact_revision`),
  ).toHaveLength(0);
});

test("F11 guest cookies and actual temporary assistant responses cannot create persisted artifacts", async () => {
  const f = await betaFixture();
  const { signedGuest } = await import("../lib/credits/guest");
  const guestRequest = new Request(`${env.BETTER_AUTH_URL}/api/artifacts`, {
    method: "POST",
    headers: {
      origin: env.BETTER_AUTH_URL,
      "content-type": "application/json",
      cookie: `__Host-galaxy-guest=${signedGuest(secret)}`,
    },
    body: JSON.stringify(creation),
  });
  expect((await POST(guestRequest)).status).toBe(401);
  const { POST: chatPost } = await import("../app/(chat)/api/chat/route");
  const temporary = chatBody({ temporary: true });
  const response = await chatPost(await f.request("/api/chat", temporary));
  expect(response.status).toBe(200);
  const wire = await response.text();
  const start = wire
    .split("\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice(6)))
    .find((part) => part.type === "start");
  expect(typeof start?.messageId).toBe("string");
  expect(
    (
      await POST(
        await f.request("/api/artifacts", {
          ...creation,
          chatId: temporary.id,
          messageId: start.messageId,
        }),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await POST(
        await f.request("/api/artifacts", {
          ...creation,
          chatId: temporary.id,
          messageId: start.messageId,
          temporary: true,
        }),
      )
    ).status,
  ).toBe(400);
  expect(await f.db.$client.unsafe("SELECT id FROM chat")).toHaveLength(0);
  expect(await f.db.$client.unsafe("SELECT id FROM chat_message")).toHaveLength(
    0,
  );
  expect(await f.db.$client.unsafe("SELECT id FROM artifact")).toHaveLength(0);
  expect(
    await f.db.$client.unsafe("SELECT artifact_id FROM artifact_revision"),
  ).toHaveLength(0);
  expect(f.seen).toHaveLength(1);
});
