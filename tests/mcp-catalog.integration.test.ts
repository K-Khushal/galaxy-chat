import { describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { mcpCatalogFixture } from "./helpers/mcp-catalog-fixture";
import { rejectionOf } from "./helpers/rejection";
import { setupFixtureBeforeEach } from "./helpers/setup-fixture";

mock.module("server-only", () => ({}));
const {
  createMcpCatalogStore,
  createFixtureMcpCatalogStore,
  verifyMcpActionInTx,
} = await import("../lib/mcp/catalog-store");
const { resourceActor } = await import("../lib/byok/config");

describe("owned MCP catalogs and proposals — synthetic offline data, no dispatch or real cost proof", () => {
  const get = setupFixtureBeforeEach(mcpCatalogFixture);
  test("production issuer and verifier unavailable; fixture gate checked at construction and mutation", async () => {
    const f = get(),
      raw = f.catalogInput(),
      production = createMcpCatalogStore({ db: f.db });
    expect(
      await rejectionOf(production.importUntrusted("alice", raw)),
    ).toMatchObject({ id: "mcp_catalog_authority_unavailable" });
    expect(await rejectionOf(production.propose("alice", {}))).toMatchObject({
      id: "mcp_catalog_authority_unavailable",
    });
    expect(
      await rejectionOf(
        f.db.transaction((tx) =>
          verifyMcpActionInTx(tx, "alice", crypto.randomUUID(), {
            runId: crypto.randomUUID(),
            toolCallId: "none",
            tool: "none",
            toolRevision: "none",
            connectionRevision: "none",
            arguments: {},
            target: "none",
            costMicrodollars: 0,
          }),
        ),
      ),
    ).toMatchObject({ id: "mcp_catalog_authority_unavailable" });
    const previous = process.env.NODE_ENV;
    try {
      Reflect.set(process.env, "NODE_ENV", "production");
      expect(() =>
        createFixtureMcpCatalogStore({
          db: f.db,
          runtime: () => ({ fee: f.fee }),
        }),
      ).toThrow("mcp_catalog_authority_unavailable");
      expect(
        await rejectionOf(f.store.importUntrusted("alice", raw)),
      ).toMatchObject({ id: "mcp_catalog_authority_unavailable" });
    } finally {
      if (previous === undefined)
        Reflect.deleteProperty(process.env, "NODE_ENV");
      else Reflect.set(process.env, "NODE_ENV", previous);
    }
    expect(f.seen).toHaveLength(0);
  });
  test("exact import is idempotent; changed same version, stale CAS, revocation and foreign connection fail", async () => {
    const f = get(),
      first = await f.catalog();
    expect(await f.store.importUntrusted("alice", first.input)).toEqual(
      first.metadata,
    );
    expect(
      await rejectionOf(
        f.store.importUntrusted("alice", {
          ...first.input,
          tools: [{ ...first.input.tools[0], description: "changed" }],
        }),
      ),
    ).toMatchObject({ id: "mcp_catalog_conflict" });
    expect(
      await rejectionOf(
        f.catalog("alice", {
          revision: "v2",
          expectedHeadRevision: crypto.randomUUID(),
        }),
      ),
    ).toMatchObject({ id: "mcp_catalog_conflict" });
    expect(
      await rejectionOf(f.store.importUntrusted("bob", first.input)),
    ).toMatchObject({ id: "not_found" });
    const second = await f.catalog("alice", {
      revision: "v2",
      expectedHeadRevision: first.metadata.headRevision,
    });
    expect(
      await rejectionOf(f.store.importUntrusted("alice", first.input)),
    ).toMatchObject({ id: "mcp_catalog_conflict" });
    await f.store.revoke(
      "alice",
      second.input.connection.id,
      second.metadata.headRevision,
    );
    expect(
      await rejectionOf(f.store.importUntrusted("alice", second.input)),
    ).toMatchObject({ id: "mcp_catalog_conflict" });
    expect(
      await rejectionOf(
        f.store.revoke(
          "bob",
          second.input.connection.id,
          second.metadata.headRevision,
        ),
      ),
    ).toMatchObject({ id: "not_found" });
    expect((await f.store.export("bob")).catalogs).toEqual([]);
  });
  test("only invited owned mcp.call profile can import; duplicate names, tools, output schemas and arbitrary metadata are bounded", async () => {
    const f = get(),
      raw = f.catalogInput();
    for (const input of [
      { ...raw, profile: { ...raw.profile, purpose: "mcp.list" } },
      { ...raw, tools: Array.from({ length: 11 }, () => raw.tools[0]) },
      { ...raw, tools: [raw.tools[0], raw.tools[0]] },
      {
        ...raw,
        tools: [
          {
            ...raw.tools[0],
            outputSchema: { $ref: "https://untrusted.example/schema" },
          },
        ],
      },
      { ...raw, token: "forbidden metadata" },
    ])
      expect(
        await rejectionOf(f.store.importUntrusted("alice", input)),
      ).toBeDefined();
    const { parseProfileEntry } = await import("../lib/mcp/config");
    const { computeProfileDigest } = await import(
      "../lib/mcp/registry-contract"
    );
    const configured = JSON.parse(process.env.MCP_CLIENT_PROFILES_JSON ?? "[]");
    const listProfile = parseProfileEntry({
      ...configured[0],
      purpose: "mcp.list",
    });
    process.env.MCP_CLIENT_PROFILES_JSON = JSON.stringify([
      ...configured,
      listProfile,
    ]);
    const listId = crypto.randomUUID(),
      listRevision = crypto.randomUUID();
    await f.db.execute(
      sql`INSERT INTO mcp_connection(id,user_id,profile_id,profile_revision,purpose,profile_digest,label,state,revision) VALUES (${listId},'alice',${listProfile.profileId},${listProfile.revision},'mcp.list',${computeProfileDigest(listProfile)},'Owned list fixture','configured',${listRevision})`,
    );
    expect(
      await rejectionOf(
        f.store.importUntrusted("alice", {
          ...raw,
          connection: { id: listId, revision: listRevision },
          profile: {
            ...raw.profile,
            digest: computeProfileDigest(listProfile),
          },
        }),
      ),
    ).toMatchObject({ id: "mcp_connection_changed" });
    process.env.GITHUB_INVITE_LOGINS = "bob";
    expect(
      await rejectionOf(f.store.importUntrusted("alice", raw)),
    ).toMatchObject({ id: "mcp_invite_required" });
    expect((await f.store.export("alice")).catalogs).toHaveLength(0);
  });
  test("ten unique tools persist completely and an eleventh unique tool cannot bypass the catalog bound", async () => {
    const f = get(),
      input = f.catalogInput();
    const tools = Array.from({ length: 10 }, (_, i) => ({
      ...input.tools[0],
      name: `action_${i}`,
    }));
    const metadata = await f.store.importUntrusted("alice", {
      ...input,
      tools,
    });
    expect(metadata.tools).toBe(10);
    const [stored] = await f.db.execute<{ count: number }>(
      sql`SELECT count(*)::integer AS count FROM mcp_catalog_action`,
    );
    expect(stored.count).toBe(10);
    expect(
      await rejectionOf(
        f.store.importUntrusted("alice", {
          ...input,
          id: crypto.randomUUID(),
          revision: "v2",
          expectedHeadRevision: metadata.headRevision,
          tools: [...tools, { ...input.tools[0], name: "action_10" }],
        }),
      ),
    ).toMatchObject({ id: "invalid_mcp_catalog" });
  });
  test("a real owned running SQL tool run is required; readOnlyHint never grants approval or bypasses exact arguments", async () => {
    const f = get(),
      catalog = await f.catalog(),
      run = await f.run(),
      call = await f.call(run.id),
      request = f.proposal(catalog, run, call);
    expect(
      await rejectionOf(
        f.store.propose("alice", { ...request, runId: crypto.randomUUID() }),
      ),
    ).toMatchObject({ id: "not_found" });
    expect(await rejectionOf(f.store.propose("bob", request))).toMatchObject({
      id: "not_found",
    });
    expect(
      await rejectionOf(
        f.store.propose("alice", {
          ...request,
          arguments: { message: "ok", unexpected: true },
        }),
      ),
    ).toMatchObject({ id: "mcp_arguments_rejected" });
    const arithmeticCall = crypto.randomUUID();
    await f.tools.event("alice", run.id, {
      id: arithmeticCall,
      name: "arithmetic",
      state: "queued",
    });
    expect(
      await rejectionOf(
        f.store.propose("alice", { ...request, toolCallId: arithmeticCall }),
      ),
    ).toMatchObject({ id: "mcp_tool_run_unavailable" });
    const proposed = await f.store.propose("alice", request);
    expect((await f.store.export("alice")).proposals).toEqual([
      expect.objectContaining({ id: proposed.id, state: "pending" }),
    ]);
    expect(
      await rejectionOf(
        f.store.consume("alice", proposed.id, proposed.binding),
      ),
    ).toMatchObject({ id: "tool_approval_denied" });
    expect(
      await rejectionOf(
        f.tools.issueApproval(
          "alice",
          proposed.binding,
          new Date(Date.now() + 10000),
        ),
      ),
    ).toMatchObject({ id: "mcp_catalog_authority_unavailable" });
    expect(
      await rejectionOf(
        f.tools.consumeApproval("alice", proposed.approvalId, proposed.binding),
      ),
    ).toMatchObject({ id: "mcp_catalog_authority_unavailable" });
    expect(f.seen).toHaveLength(0);
  });
  test("owned explicit approve, deny and revoke share ToolStore decisions; exact consumption commits once", async () => {
    const f = get(),
      catalog = await f.catalog(),
      run = await f.run();
    const first = await f.store.propose(
      "alice",
      f.proposal(catalog, run, await f.call(run.id)),
    );
    expect(
      await rejectionOf(f.store.decide("bob", first.id, "approve")),
    ).toMatchObject({ id: "not_found" });
    await f.store.decide("alice", first.id, "approve");
    expect(
      await rejectionOf(
        f.store.consume("alice", first.id, {
          ...first.binding,
          arguments: { message: "changed" },
        }),
      ),
    ).toMatchObject({ id: "mcp_action_changed" });
    const results = await Promise.allSettled([
      f.store.consume("alice", first.id, first.binding),
      f.store.consume("alice", first.id, first.binding),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const denied = await f.store.propose(
      "alice",
      f.proposal(catalog, run, await f.call(run.id)),
    );
    await f.store.decide("alice", denied.id, "deny");
    expect(
      await rejectionOf(f.store.consume("alice", denied.id, denied.binding)),
    ).toMatchObject({ id: "tool_approval_denied" });
    const revoked = await f.store.propose(
      "alice",
      f.proposal(catalog, run, await f.call(run.id)),
    );
    await f.store.decide("alice", revoked.id, "approve");
    await f.store.decide("alice", revoked.id, "revoke");
    expect(
      await rejectionOf(f.store.consume("alice", revoked.id, revoked.binding)),
    ).toMatchObject({ id: "tool_approval_denied" });
    const states = (await f.store.export("alice")).proposals.map(
      (row) => row.state,
    );
    expect(states).toEqual(["consumed", "denied", "revoked"]);
  });
  test("catalog head changes revoke pending approvals, and connection disable invalidates approved proposals", async () => {
    const f = get(),
      catalog = await f.catalog(),
      run = await f.run();
    const old = await f.store.propose(
      "alice",
      f.proposal(catalog, run, await f.call(run.id)),
    );
    await f.store.decide("alice", old.id, "approve");
    const next = await f.catalog("alice", {
      revision: "v2",
      expectedHeadRevision: catalog.metadata.headRevision,
    });
    expect((await f.store.export("alice")).proposals[0].state).toBe("revoked");
    expect(
      await rejectionOf(f.store.consume("alice", old.id, old.binding)),
    ).toMatchObject({ id: "mcp_catalog_changed" });
    const proposed = await f.store.propose(
      "alice",
      f.proposal(next, run, await f.call(run.id)),
    );
    await f.store.decide("alice", proposed.id, "approve");
    const { McpRegistryStore } = await import("../lib/mcp/registry-store");
    await new McpRegistryStore(f.db).disable(
      "alice",
      next.input.connection.id,
      next.input.connection.revision,
    );
    expect(
      await rejectionOf(
        f.store.consume("alice", proposed.id, proposed.binding),
      ),
    ).toMatchObject({ id: "mcp_connection_changed" });
  });
  test("the existing four approvals/run and run-created+20s ceiling remain exact and shared", async () => {
    const f = get(),
      catalog = await f.catalog(),
      run = await f.run();
    for (let i = 0; i < 3; i++)
      await f.tools.issueApproval(
        "alice",
        {
          runId: run.id,
          toolCallId: `generic-${i}`,
          tool: "fixture",
          toolRevision: "v1",
          connectionRevision: "none",
          arguments: {},
          target: "fixture",
          costMicrodollars: 1,
        },
        new Date(Date.now() + 60000),
      );
    const proposed = await f.store.propose(
      "alice",
      f.proposal(catalog, run, await f.call(run.id)),
    );
    const [bound] = await f.db.execute<{
      count: number;
      within_run: boolean;
      remaining_ms: number;
    }>(
      sql`SELECT (SELECT count(*)::integer FROM tool_approval WHERE run_id=${run.id}) AS count,a.expires_at<=r.created_at+interval '20 seconds' AS within_run,extract(epoch FROM (a.expires_at-r.created_at))*1000 AS remaining_ms FROM tool_approval a JOIN tool_run r ON r.id=a.run_id WHERE a.id=${proposed.approvalId}`,
    );
    expect(bound.count).toBe(4);
    expect(bound.within_run).toBe(true);
    expect(Number(bound.remaining_ms)).toBeLessThanOrEqual(20000);
    expect(
      await rejectionOf(
        f.store.propose(
          "alice",
          f.proposal(catalog, run, await f.call(run.id)),
        ),
      ),
    ).toMatchObject({ id: "tool_approval_limit" });
    expect((await f.store.export("alice")).proposals).toHaveLength(1);
  });
  test("caller argument/identity mutations during the first real lock cannot alter an owned proposal snapshot", async () => {
    const f = get(),
      catalog = await f.catalog(),
      run = await f.run(),
      request = f.proposal(catalog, run, await f.call(run.id)),
      original = structuredClone(request);
    let changed = false;
    f.afterQuery((statement) => {
      if (changed || !statement.includes("pg_advisory_xact_lock")) return;
      changed = true;
      request.arguments.message = "mutated";
      request.plan.digest = "0".repeat(64);
      request.target = "mutated";
      request.catalog.digest = "0".repeat(64);
    });
    const proposed = await f.store.propose("alice", request);
    f.afterQuery(undefined);
    expect(changed).toBe(true);
    expect(proposed.binding.arguments).toEqual(original.arguments);
    expect(proposed.binding.target).toBe(original.target);
    expect(proposed.binding.mcp.plan).toEqual(original.plan);
    await f.store.decide("alice", proposed.id, "approve");
    await f.store.consume("alice", proposed.id, proposed.binding);
  });
  for (const phase of ["propose", "consume"] as const)
    for (const change of [
      "fee",
      "plan",
      "kill",
      "invite",
      "expiry",
      "profile",
      "model",
    ] as const)
      test(`${phase} rolls back when ${change} changes after its final real write/query`, async () => {
        const f = get(),
          catalog = await f.catalog(),
          run = await f.run(),
          request = f.proposal(catalog, run, await f.call(run.id));
        const proposed =
          phase === "consume"
            ? await f.store.propose("alice", request)
            : undefined;
        if (proposed) await f.store.decide("alice", proposed.id, "approve");
        let written = false,
          changed = false;
        f.afterQuery((statement, result) => {
          if (
            statement.includes(
              phase === "propose"
                ? "INSERT INTO mcp_action_proposal"
                : "UPDATE tool_approval SET state='consumed'",
            )
          )
            written = true;
          if (
            !written ||
            changed ||
            !statement.includes("p.digest AS proposal_digest")
          )
            return;
          changed = true;
          if (change === "fee")
            f.setRuntime({
              ...f.runtime,
              fee: { ...f.fee, revision: "changed-after-write" },
            });
          if (change === "kill") process.env.FUNDED_KILL_SWITCH = "1";
          if (change === "plan")
            process.env.PLATFORM_BUDGET_PLAN_JSON = JSON.stringify({
              ...JSON.parse(process.env.PLATFORM_BUDGET_PLAN_JSON ?? "{}"),
              revision: crypto.randomUUID(),
            });
          if (change === "invite") process.env.GITHUB_INVITE_LOGINS = "bob";
          if (change === "profile") process.env.MCP_CLIENT_ENABLED = "0";
          if (change === "model") process.env.TOOLS_ENABLED = "0";
          if (change === "expiry" && Array.isArray(result))
            for (const row of result)
              if (row && typeof row === "object" && "now" in row)
                Reflect.set(row, "now", new Date(Date.now() + 60000));
        });
        const error = await rejectionOf(
          proposed
            ? f.store.consume("alice", proposed.id, proposed.binding)
            : f.store.propose("alice", request),
        );
        expect(error).toMatchObject({
          id:
            change === "fee" || change === "plan"
              ? "mcp_price_changed"
              : change === "kill"
                ? "mcp_action_unavailable"
                : change === "invite"
                  ? "mcp_invite_required"
                  : change === "profile"
                    ? "mcp_profile_changed"
                    : change === "model"
                      ? "tools_unavailable"
                      : "mcp_tool_run_unavailable",
        });
        expect(changed).toBe(true);
        f.afterQuery(undefined);
        const [counts] = await f.db.execute<{
          proposals: number;
          approvals: number;
          admissions: number;
          state: string | null;
        }>(
          sql`SELECT (SELECT count(*)::integer FROM mcp_action_proposal) AS proposals,(SELECT count(*)::integer FROM tool_approval) AS approvals,(SELECT count(*)::integer FROM mcp_catalog_admission WHERE kind='proposal') AS admissions,(SELECT state FROM tool_approval LIMIT 1) AS state`,
        );
        expect(counts).toEqual(
          proposed
            ? { proposals: 1, approvals: 1, admissions: 1, state: "approved" }
            : { proposals: 0, approvals: 0, admissions: 0, state: null },
        );
        expect(f.seen).toHaveLength(0);
      });
  test("retained revision counters survive account cascade and prevent delete/recreate capacity reset", async () => {
    const f = get(),
      actor = resourceActor("alice", process.env);
    for (let i = 0; i < 19; i++)
      await f.db.execute(
        sql`INSERT INTO mcp_catalog_admission(id,actor_key,kind) VALUES (${crypto.randomUUID()},${actor},'revision')`,
      );
    const imported = await f.catalog();
    expect(
      await rejectionOf(f.catalog("alice", { revision: "next" })),
    ).toMatchObject({ id: "mcp_catalog_conflict" });
    const current = await f.store.export("alice");
    const [head] = await f.db.execute<{ revision: string }>(
      sql`SELECT revision FROM mcp_catalog_head WHERE user_id='alice'`,
    );
    expect(
      await rejectionOf(
        f.catalog("alice", {
          revision: "next",
          expectedHeadRevision: head.revision,
        }),
      ),
    ).toMatchObject({ id: "mcp_catalog_limit" });
    expect(current.catalogs).toHaveLength(1);
    const { deleteOwnedAccount } = await import(
      "../lib/actions/account/account"
    );
    await deleteOwnedAccount("alice");
    const [row] = await f.db.execute<{ count: number; owned: number }>(
      sql`SELECT (SELECT count(*)::integer FROM mcp_catalog_admission) AS count,(SELECT count(*)::integer FROM mcp_catalog_revision) AS owned`,
    );
    expect(row).toEqual({ count: 20, owned: 0 });
    await f.db.execute(
      sql`INSERT INTO "user"(id,name,email,github_login,email_verified) VALUES ('alice','Recreated fixture owner','recreated-alice@example.test','alice',true)`,
    );
    const original = imported.input;
    await f.db.execute(
      sql`INSERT INTO mcp_connection(id,user_id,profile_id,profile_revision,purpose,profile_digest,label,state,revision) VALUES (${original.connection.id},'alice',${original.profile.id},${original.profile.revision},'mcp.call',${original.profile.digest},'Recreated fixture','configured',${original.connection.revision})`,
    );
    expect(await rejectionOf(f.catalog())).toMatchObject({
      id: "mcp_catalog_limit",
    });
  });
  for (const scenario of [
    { kind: "revision", global: true, count: 200 },
    { kind: "proposal", global: false, count: 100 },
    { kind: "proposal", global: true, count: 1000 },
  ] as const)
    test(`retained ${scenario.global ? "global" : "owner"} ${scenario.kind} bound denies admission atomically`, async () => {
      const f = get(),
        actor = resourceActor(scenario.global ? "bob" : "alice", process.env);
      const imported =
        scenario.kind === "proposal" ? await f.catalog() : undefined;
      const run = imported ? await f.run() : undefined;
      const request =
        imported && run
          ? f.proposal(imported, run, await f.call(run.id))
          : undefined;
      const prefix = crypto.randomUUID();
      // Anonymous retained metadata only; this does not invent runs, fees or financial records.
      await f.db.execute(
        sql`INSERT INTO mcp_catalog_admission(id,actor_key,kind) SELECT ${prefix}||i::text,${actor},${scenario.kind} FROM generate_series(1,${scenario.count}::integer)i`,
      );
      expect(
        await rejectionOf(
          request ? f.store.propose("alice", request) : f.catalog(),
        ),
      ).toMatchObject({ id: "mcp_catalog_limit" });
      const [retained] = await f.db.execute<{
        count: number;
        proposals: number;
        approvals: number;
      }>(
        sql`SELECT (SELECT count(*)::integer FROM mcp_catalog_admission WHERE kind=${scenario.kind}) AS count,(SELECT count(*)::integer FROM mcp_action_proposal) AS proposals,(SELECT count(*)::integer FROM tool_approval) AS approvals`,
      );
      expect(retained).toEqual({
        count: scenario.count,
        proposals: 0,
        approvals: 0,
      });
    });
  test("sanitized account metadata is owned; deletion retains all anonymous financial obligations", async () => {
    const f = get(),
      catalog = await f.catalog(),
      run = await f.run(),
      proposed = await f.store.propose(
        "alice",
        f.proposal(catalog, run, await f.call(run.id)),
      );
    const financial = await f.authorized();
    await f.operations.reserve("alice", financial);
    await f.operations.enter("alice", financial.id, 1);
    const { exportOwnedAccount, deleteOwnedAccount } = await import(
      "../lib/actions/account/account"
    );
    const exported = await exportOwnedAccount("alice");
    expect(exported.mcpCatalogs.catalogs).toEqual([
      expect.objectContaining({ id: catalog.input.id }),
    ]);
    expect(exported.mcpCatalogs.proposals).toEqual([
      expect.objectContaining({ id: proposed.id, state: "pending" }),
    ]);
    expect((await exportOwnedAccount("bob")).mcpCatalogs).toEqual({
      catalogs: [],
      proposals: [],
    });
    for (const secret of [
      "arguments",
      "schema",
      "digest",
      "credential",
      "target",
    ])
      expect(JSON.stringify(exported.mcpCatalogs)).not.toContain(secret);
    await deleteOwnedAccount("alice");
    const [row] = await f.db.execute<{
      state: string;
      amount: string;
      commitment: string;
      catalogs: number;
      proposals: number;
    }>(
      sql`SELECT o.state,o.reserved_microdollars::text AS amount,(SELECT amount_microdollars::text FROM mcp_operation_commitment WHERE source_id=o.id) AS commitment,(SELECT count(*)::integer FROM mcp_catalog_revision) AS catalogs,(SELECT count(*)::integer FROM mcp_action_proposal) AS proposals FROM mcp_operation o WHERE o.id=${financial.id}`,
    );
    expect(row).toEqual({
      state: "entered",
      amount: "10000",
      commitment: "10000",
      catalogs: 0,
      proposals: 0,
    });
  });
  test("SQL protects immutable definitions and approval legal states; malformed proposal bindings fail named CHECK", async () => {
    const f = get(),
      catalog = await f.catalog(),
      run = await f.run(),
      proposed = await f.store.propose(
        "alice",
        f.proposal(catalog, run, await f.call(run.id)),
      );
    for (const statement of [
      "UPDATE mcp_catalog_revision SET digest=repeat('0',64)",
      "UPDATE mcp_catalog_action SET schema_digest=repeat('0',64)",
      "UPDATE mcp_action_proposal SET binding='{}'::jsonb",
      "UPDATE tool_approval SET binding='{}'::jsonb",
      "UPDATE tool_approval SET state='consumed'",
      "DELETE FROM mcp_catalog_admission",
    ]) {
      expect(
        await rejectionOf(f.db.$client.unsafe(statement).simple()),
      ).toMatchObject({ code: "P0001" });
      expect((await f.store.export("alice")).proposals[0].state).toBe(
        "pending",
      );
    }
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const good = proposed.binding;
    const malformed: unknown[] = [
      null,
      {},
      [],
      true,
      "binding",
      { runId: run.id, toolCallId: proposed.binding.toolCallId, mcp: null },
      { runId: run.id, toolCallId: proposed.binding.toolCallId, mcp: {} },
      { ...good, arguments: [] },
      { ...good, target: null },
      { ...good, extra: true },
      { ...good, costMicrodollars: "10000" },
      { ...good, costMicrodollars: {} },
      { ...good, costMicrodollars: 1.5 },
      { ...good, mcp: { ...good.mcp, schemaDigest: 12 } },
      { ...good, mcp: { ...good.mcp, feeDigest: null } },
      { ...good, mcp: { ...good.mcp, plan: undefined } },
      {
        ...good,
        mcp: { ...good.mcp, plan: { ...good.mcp.plan, capacityDigest: null } },
      },
      {
        ...good,
        mcp: { ...good.mcp, proposal: { ...good.mcp.proposal, revision: "1" } },
      },
      {
        ...good,
        mcp: { ...good.mcp, profile: { ...good.mcp.profile, purpose: null } },
      },
    ];
    for (const raw of malformed) {
      const id = crypto.randomUUID(),
        approval = crypto.randomUUID();
      const binding = structuredClone(raw);
      if (binding && typeof binding === "object" && !Array.isArray(binding)) {
        const mcp = Reflect.get(binding, "mcp");
        if (mcp && typeof mcp === "object") {
          const proposal = Reflect.get(mcp, "proposal");
          if (proposal && typeof proposal === "object")
            Reflect.set(proposal, "id", id);
        }
      }
      const encoded = quote(JSON.stringify(binding));
      await f.db.$client
        .unsafe(
          `INSERT INTO tool_approval(id,user_id,run_id,binding,expires_at) VALUES (${quote(approval)},'alice',${quote(run.id)},${encoded}::jsonb,clock_timestamp()+interval '1 second')`,
        )
        .simple();
      expect(
        await rejectionOf(
          f.db.$client
            .unsafe(
              `INSERT INTO mcp_action_proposal(id,revision,user_id,catalog_id,action_name,run_id,tool_call_id,binding,digest,approval_id,approval_digest) VALUES (${quote(id)},1,'alice',${quote(catalog.input.id)},'write_note',${quote(run.id)},${quote(proposed.binding.toolCallId)},${encoded}::jsonb,${quote(proposed.binding.mcp.proposal.digest)},${quote(approval)},repeat('a',64))`,
            )
            .simple(),
        ),
      ).toMatchObject({
        code: "23514",
        message: expect.stringContaining("mcp_proposal_binding_valid"),
      });
      expect((await f.store.export("alice")).proposals).toHaveLength(1);
    }
  });
});

test("populated 0018 upgrade retains financial records/receipts/carry unchanged and new metadata tables are private", async () => {
  const engine = await PGlite.create();
  try {
    for (const file of readdirSync("drizzle")
      .filter((name) => name.endsWith(".sql") && name < "0019")
      .sort())
      await engine.exec(readFileSync(`drizzle/${file}`, "utf8"));
    const id = crypto.randomUUID(),
      receiptId = crypto.randomUUID(),
      receipt = {
        id: receiptId,
        operationId: id,
        bindingDigest: "b".repeat(64),
        evidenceDigest: "e".repeat(64),
        incurredMicrodollars: 5000,
        terminal: true,
        revision: "synthetic-legacy",
      };
    await engine.query(
      "INSERT INTO mcp_operation(id,actor_key,actor_version,idempotency_key,binding_digest,identity,fee_snapshot,month,day,state,reserved_microdollars,incurred_microdollars,attempts,deadline,receipt_id,receipt) VALUES ($1,repeat('a',64),'v1','once',repeat('b',64),'{}','{}','2026-01','2026-01-01','settled',10000,5000,1,'2026-01-02',$2,$3::jsonb)",
      [id, receiptId, JSON.stringify(receipt)],
    );
    await engine.query(
      "INSERT INTO mcp_fixture_receipt(id,operation_id,receipt) VALUES ($1,$2,$3::jsonb)",
      [receiptId, id, JSON.stringify(receipt)],
    );
    await engine.exec(
      "INSERT INTO mcp_operation_period(month,plan_identity,sources_digest) VALUES ('2026-01','{}',repeat('c',64))",
    );
    await engine.query(
      "INSERT INTO mcp_operation_commitment(month,source_id,amount_microdollars) VALUES ('2026-01',$1,10000)",
      [id],
    );
    const snapshot = async () =>
      Promise.all(
        [
          "mcp_operation",
          "mcp_fixture_receipt",
          "mcp_operation_period",
          "mcp_operation_commitment",
        ].map(
          async (table) => (await engine.query(`SELECT * FROM ${table}`)).rows,
        ),
      );
    const before = await snapshot();
    await engine.exec(
      readFileSync("drizzle/0019_mcp_catalog_actions.sql", "utf8"),
    );
    expect(await snapshot()).toEqual(before);
    const rls = await engine.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname IN ('mcp_catalog_revision','mcp_catalog_action','mcp_catalog_head','mcp_catalog_admission','mcp_action_proposal')",
    );
    expect(rls.rows).toHaveLength(5);
    expect(rls.rows.every((row) => row.relrowsecurity)).toBe(true);
  } finally {
    await engine.close();
  }
});
