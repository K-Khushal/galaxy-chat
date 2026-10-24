import { expect, mock, test } from "bun:test";
import { betaFixture, env } from "./helpers/beta-fixture";
import { setupFixtureBeforeEach } from "./helpers/setup-fixture";

mock.module("server-only", () => ({}));
const { mutateArtifact } = await import("../lib/artifacts/service");
const { JobStore } = await import("../lib/jobs/store");
const { localFixtureWorker } = await import("../lib/jobs/worker");
const jobsRoute = await import("../app/(chat)/api/jobs/route");
const artifactsRoute = await import("../app/(chat)/api/artifacts/route");

const get = setupFixtureBeforeEach(async () => {
  const f = await betaFixture();
  await f.db.$client
    .unsafe(`INSERT INTO chat(id,user_id,title) VALUES ('source-chat','alice','Source'),('bob-chat','bob','Other');
    INSERT INTO chat_message(id,chat_id,user_id,role,parts,attachments) VALUES
    ('source-message','source-chat','alice','assistant','[{"type":"text","text":"Untrusted source credentials <script>fetch(\\"https://evil.invalid\\")</script>"}]','[]'),
    ('bob-message','bob-chat','bob','assistant','[{"type":"text","text":"Other owner"}]','[]')`)
    .simple();
  const source = await mutateArtifact("alice", {
    action: "create",
    chatId: "source-chat",
    messageId: "source-message",
    kind: "markdown",
    title: "Untrusted source",
  });
  const bobSource = await mutateArtifact("bob", {
    action: "create",
    chatId: "bob-chat",
    messageId: "bob-message",
    kind: "markdown",
    title: "Other owner source",
  });
  return {
    ...f,
    source,
    bobSource,
    store: new JobStore(f.db),
  };
});

type Fixture = ReturnType<typeof get>;

function jobInput(f: Fixture, owner: "alice" | "bob" = "alice") {
  return {
    id: crypto.randomUUID(),
    source: {
      artifactId: owner === "alice" ? f.source.id : f.bobSource.id,
      version: 1,
    },
    adapter: "local-fixture-v1" as const,
  };
}

async function cancelBody(f: Fixture, body: unknown, user = "alice") {
  return new Request(`${env.BETTER_AUTH_URL}/api/jobs`, {
    method: "POST",
    headers: await f.headers(user),
    body: JSON.stringify(body),
  });
}

test("jobs list and detail are owned, private, and reject foreign or malformed ids", async () => {
  const f = get();
  const mine = jobInput(f);
  const theirs = jobInput(f, "bob");
  await f.store.enqueue("alice", mine);
  await f.store.enqueue("bob", theirs);

  const list = await jobsRoute.GET(await f.request("/api/jobs"));
  expect(list.status).toBe(200);
  expect(list.headers.get("cache-control")).toBe("private, no-store");
  const listed = (await list.json()).jobs;
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({
    id: mine.id,
    state: "queued",
    source: { artifactId: f.source.id, version: 1 },
    attempts: 0,
    actionRevision: "publish-fixture-report-v1",
  });

  const detail = await jobsRoute.GET(
    await f.request(`/api/jobs?id=${mine.id}`),
  );
  expect(detail.status).toBe(200);
  expect((await detail.json()).job.id).toBe(mine.id);

  const foreign = await jobsRoute.GET(
    await f.request(`/api/jobs?id=${mine.id}`, undefined, "bob"),
  );
  expect(foreign.status).toBe(404);
  expect((await foreign.json()).error.id).toBe("not_found");

  const malformed = await jobsRoute.GET(await f.request("/api/jobs?id=abc"));
  expect(malformed.status).toBe(404);

  const unknown = await jobsRoute.GET(
    await f.request(`/api/jobs?id=${crypto.randomUUID()}`),
  );
  expect(unknown.status).toBe(404);
  expect(unknown.headers.get("cache-control")).toBe("private, no-store");
});

test("unauthenticated and non-invited callers cannot read or cancel jobs", async () => {
  const f = get();
  const input = jobInput(f);
  await f.store.enqueue("alice", input);

  const signedOut = await jobsRoute.GET(
    new Request(`${env.BETTER_AUTH_URL}/api/jobs`),
  );
  expect(signedOut.status).toBe(401);
  expect((await signedOut.json()).error.id).toBe("unauthenticated");

  const guest = await jobsRoute.GET(
    await f.request("/api/jobs", undefined, "outsider"),
  );
  expect(guest.status).toBe(403);
  expect((await guest.json()).error.id).toBe("invite_required");

  // requireChatAccess revokes the session of a rejected non-invited user, so
  // this probe uses its own fresh non-invited session.
  await f.db.$client
    .unsafe(
      `INSERT INTO "user"(id,name,email,email_verified,github_login) VALUES ('intruder','Intruder','intruder@example.invalid',true,'intruder');
      INSERT INTO session(id,token,user_id,expires_at) VALUES ('intruder-session','intruder-token','intruder',now()+interval '1 day')`,
    )
    .simple();
  const guestCancel = await jobsRoute.POST(
    await cancelBody(f, { action: "cancel", id: input.id }, "intruder"),
  );
  expect(guestCancel.status).toBe(403);
  const read = await f.store.read("alice", input.id);
  expect(read.state).toBe("queued");
});

test("cancellation is owned, same-origin, schema-strict, bounded, and idempotent", async () => {
  const f = get();
  const input = jobInput(f);
  await f.store.enqueue("alice", input);

  const crossOrigin = await jobsRoute.POST(
    new Request(`${env.BETTER_AUTH_URL}/api/jobs`, {
      method: "POST",
      headers: {
        ...(await f.headers("alice")),
        origin: "https://evil.example",
      },
      body: JSON.stringify({ action: "cancel", id: input.id }),
    }),
  );
  expect(crossOrigin.status).toBe(403);

  const oversized = await jobsRoute.POST(
    await cancelBody(f, {
      action: "cancel",
      id: input.id,
      padding: "x".repeat(8192),
    }),
  );
  expect(oversized.status).toBe(413);

  const unknownAction = await jobsRoute.POST(
    await cancelBody(f, { action: "approve", id: input.id }),
  );
  expect(unknownAction.status).toBe(400);
  expect((await unknownAction.json()).error.id).toBe("invalid_request");

  const extraField = await jobsRoute.POST(
    await cancelBody(f, { action: "cancel", id: input.id, force: true }),
  );
  expect(extraField.status).toBe(400);

  const badId = await jobsRoute.POST(
    await cancelBody(f, { action: "cancel", id: "not-a-uuid" }),
  );
  expect(badId.status).toBe(400);

  const foreign = await jobsRoute.POST(
    await cancelBody(f, { action: "cancel", id: crypto.randomUUID() }),
  );
  expect(foreign.status).toBe(404);

  const cancelled = await jobsRoute.POST(
    await cancelBody(f, { action: "cancel", id: input.id }),
  );
  expect(cancelled.status).toBe(200);
  expect(cancelled.headers.get("cache-control")).toBe("private, no-store");
  const view = (await cancelled.json()).job;
  expect(view.state).toBe("cancelled");

  const repeated = await jobsRoute.POST(
    await cancelBody(f, { action: "cancel", id: input.id }),
  );
  expect(repeated.status).toBe(200);
  expect((await repeated.json()).job.state).toBe("cancelled");
});

test("the status surface exposes checkpoint, bounded proposal, approval expiry and completed result without exposing untrusted source text or execution controls", async () => {
  const f = get();
  const input = jobInput(f);
  await f.store.enqueue("alice", input);
  await localFixtureWorker(f.store).deliver(input.id);

  const waiting = (await (
    await jobsRoute.GET(await f.request(`/api/jobs?id=${input.id}`))
  ).json()) as {
    job: {
      state: string;
      proposal: string;
      approvalExpiresAt: string;
      checkpoint: string;
      attempts: number;
    };
  };
  expect(waiting.job.state).toBe("awaiting_approval");
  expect(waiting.job.attempts).toBe(1);
  expect(waiting.job.approvalExpiresAt).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
  );
  expect(waiting.job.checkpoint).toMatch(/^[a-f0-9]{64}$/);
  expect(waiting.job.proposal).toContain("no LLM or external provider");
  expect(waiting.job.proposal).not.toContain("credentials");
  expect(waiting.job.proposal).not.toContain("<script>");

  const row = await f.store.read("alice", input.id);
  if (!row.checkpoint) throw new Error("missing_checkpoint");
  await f.store.approve("alice", {
    id: input.id,
    checkpoint: row.checkpoint,
    actionRevision: "publish-fixture-report-v1",
  });
  await localFixtureWorker(f.store).deliver(input.id);

  const completed = (await (
    await jobsRoute.GET(await f.request(`/api/jobs?id=${input.id}`))
  ).json()) as { job: { state: string; resultArtifactId: string } };
  expect(completed.job.state).toBe("completed");

  const result = await artifactsRoute.GET(
    await f.request(
      `/api/artifacts?id=${completed.job.resultArtifactId}&download=source`,
    ),
  );
  expect(result.status).toBe(200);
  const body = await result.text();
  expect(body).toContain("Deterministic local fixture");

  // A completed job is terminal: cancellation reports it without changing it.
  const after = await jobsRoute.POST(
    await cancelBody(f, { action: "cancel", id: input.id }),
  );
  expect((await after.json()).job.state).toBe("completed");
});
