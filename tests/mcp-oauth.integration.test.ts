import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { mcpOAuthFixture } from "./helpers/mcp-oauth-fixture";
import { rejectionOf } from "./helpers/rejection";
import { setupFixtureBeforeEach } from "./helpers/setup-fixture";

mock.module("server-only", () => ({}));
const { createMcpOAuthStore, createFixtureMcpOAuthStore } = await import(
  "@/lib/mcp/oauth-store"
);
const { oauthHash, openOAuthSecret, sealOAuthSecret } = await import(
  "@/lib/mcp/oauth-crypto"
);
const { operationDigest } = await import("@/lib/mcp/operation-contract");
const { oauthRuntimeSchema, oauthManifestSchema } = await import(
  "@/lib/mcp/oauth-contract"
);
describe("MCP OAuth local synthetic persistence — no issuer or transport proof", () => {
  const get = setupFixtureBeforeEach(mcpOAuthFixture);
  test("production permanently unavailable and every secret/authority method rechecks test environment", async () => {
    const f = get(),
      p = createMcpOAuthStore({ db: f.db }),
      g = await f.grant(),
      refresh = await f.bind("oauth.refresh"),
      claimInput = {
        id: crypto.randomUUID(),
        grantId: g.grant.id,
        expectedRevision: 1,
        bindingId: refresh.id,
      };
    const methods = [
      () => p.issueBinding("alice", {}),
      () => p.beginState("alice", {}),
      () => p.consumeState("alice", {}),
      () => p.installFixtureGrant("alice", {}),
      () => p.openAccess("alice", g.grant.id, 1),
      () => p.rotate("alice", g.grant.id, 1),
      () => p.reserveRefresh("alice", claimInput),
      () => p.enterRefresh("alice", claimInput.id, 1),
      () => p.replaceFixtureRefresh("alice", claimInput.id, 2, {}),
    ];
    for (const call of methods)
      expect(await rejectionOf(call())).toMatchObject({
        id: "mcp_oauth_authority_unavailable",
      });
    const prior = process.env.NODE_ENV;
    try {
      Reflect.set(process.env, "NODE_ENV", "production");
      expect(() =>
        createFixtureMcpOAuthStore({
          db: f.db,
          runtime: () => f.runtime,
          env: () => f.env,
        }),
      ).toThrow("mcp_oauth_authority_unavailable");
      for (const call of [
        () => f.store.issueBinding("alice", {}),
        () => f.store.beginState("alice", {}),
        () => f.store.consumeState("alice", {}),
        () => f.store.installFixtureGrant("alice", {}),
        () => f.store.openAccess("alice", g.grant.id, 1),
        () => f.store.rotate("alice", g.grant.id, 1),
        () => f.store.reserveRefresh("alice", claimInput),
        () => f.store.enterRefresh("alice", claimInput.id, 1),
        () => f.store.replaceFixtureRefresh("alice", claimInput.id, 2, {}),
      ])
        expect(await rejectionOf(call())).toMatchObject({
          id: "mcp_oauth_authority_unavailable",
        });
    } finally {
      if (prior === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
      else Reflect.set(process.env, "NODE_ENV", prior);
    }
    expect(await p.metadata("alice")).toEqual([g.grant]);
    expect(await p.metadata("bob")).toEqual([]);
    expect(f.seen).toHaveLength(0);
  });
  test("mcp.call ownership never implies OAuth purpose; manifests are strict exact declared endpoints", async () => {
    const f = get(),
      connection = f.connections.get("alice");
    expect(
      await rejectionOf(
        f.store.beginState("alice", {
          bindingId: connection?.id,
          expectedBindingRevision: 1,
          session: "alice-session",
          redirectUri: f.manifests[0].redirectUri,
        }),
      ),
    ).toMatchObject({ id: "not_found" });
    const refresh = await f.bind("oauth.refresh");
    expect(await rejectionOf(f.state(refresh.id))).toMatchObject({
      id: "mcp_oauth_purpose_denied",
    });
    for (const endpoint of [
      "http://issuer.example.com/token",
      "https://127.0.0.1/token",
      "https://issuer.example.com/token#x",
      "https://user@issuer.example.com/token",
      "https://issuer.example.com/token?redirect=other",
    ])
      expect(
        oauthManifestSchema.safeParse({ ...f.manifests[2], endpoint }).success,
      ).toBe(false);
    expect(
      oauthManifestSchema.safeParse({
        ...f.manifests[2],
        scopes: Array(11).fill("x"),
      }).success,
    ).toBe(false);
    expect(
      oauthRuntimeSchema.safeParse({
        ...f.runtime,
        keys: Object.fromEntries(
          Array.from({ length: 9 }, (_, i) => [
            `v${i}`,
            Buffer.alloc(32, i).toString("base64"),
          ]),
        ),
      }).success,
    ).toBe(false);
    expect(
      await rejectionOf(
        f.store.issueBinding("bob", {
          id: crypto.randomUUID(),
          connectionId: connection?.id,
          connectionRevision: connection?.revision,
          manifestId: f.manifests[2].id,
          manifestDigest: operationDigest(f.manifests[2]),
        }),
      ),
    ).toMatchObject({ id: "not_found" });
  });
  test("state is random/hash-only, S256 bound, session/owner/redirect exact and consumed once before any grant", async () => {
    const f = get(),
      binding = await f.bind(),
      pending = await f.state(binding.id),
      callback = {
        state: pending.state,
        session: "alice-session",
        redirectUri: f.manifests[0].redirectUri,
      };
    const [persisted] = await f.db.execute<{
      state_hash: string;
      session_hash: string;
      verifier: unknown;
    }>(
      sql`SELECT state_hash,session_hash,verifier FROM mcp_oauth_state WHERE id=${pending.id}`,
    );
    expect(persisted.state_hash === oauthHash(pending.state)).toBe(true);
    expect(persisted.session_hash === oauthHash(callback.session)).toBe(true);
    expect(JSON.stringify(persisted).includes(pending.state)).toBe(false);
    for (const call of [
      () => f.store.consumeState("bob", callback),
      () =>
        f.store.consumeState("alice", { ...callback, session: "bob-session" }),
      () =>
        f.store.consumeState("alice", {
          ...callback,
          redirectUri: "https://evil.example.com/callback",
        }),
    ])
      expect(await rejectionOf(call())).toBeDefined();
    const consumed = await f.store.consumeState("alice", callback);
    expect(
      createHash("sha256").update(consumed.verifier).digest("base64url") ===
        pending.challenge,
    ).toBe(true);
    expect(
      await rejectionOf(f.store.consumeState("alice", callback)),
    ).toMatchObject({ id: "mcp_oauth_state_denied" });
    const [row] = await f.db.execute<{ state: string; verifier: unknown }>(
      sql`SELECT state,verifier FROM mcp_oauth_state WHERE id=${pending.id}`,
    );
    expect(row).toEqual({ state: "consumed", verifier: null });
    expect(f.seen).toHaveLength(0);
  });
  test("cipher AAD/key rotation requires old key; stale revision and swapped identity cannot open; sanitized export", async () => {
    const f = get(),
      g = await f.grant(),
      expected = g.input.accessToken;
    expect(
      (await f.store.openAccess("alice", g.grant.id, 1)) === expected,
    ).toBe(true);
    const binding = {
      ownerId: "alice",
      connectionId: g.binding.id,
      connectionRevision: "synthetic",
      grantId: g.grant.id,
      profileDigest: "a".repeat(64),
      manifestDigest: "b".repeat(64),
      credentialRevision: 1,
      kind: "access" as const,
    };
    const sealed = sealOAuthSecret(expected, binding, f.runtime);
    for (const changed of [
      { ...binding, ownerId: "bob" },
      { ...binding, kind: "refresh" as const },
      { ...binding, credentialRevision: 2 },
      { ...binding, manifestDigest: "c".repeat(64) },
    ])
      expect(() => openOAuthSecret(sealed, changed, f.runtime)).toThrow(
        "mcp_oauth_key_unavailable",
      );
    expect(() =>
      openOAuthSecret(
        { ...sealed, ciphertext: `${sealed.ciphertext.slice(0, -4)}AAAA` },
        binding,
        f.runtime,
      ),
    ).toThrow("mcp_oauth_key_unavailable");
    const old = f.runtime;
    f.setRuntime({
      ...old,
      activeKeyVersion: "v2",
      keys: { v2: Buffer.alloc(32, 43).toString("base64") },
    });
    expect(
      await rejectionOf(f.store.rotate("alice", g.grant.id, 1)),
    ).toMatchObject({ id: "mcp_oauth_key_unavailable" });
    f.setRuntime({ ...f.runtime, keys: { ...old.keys, ...f.runtime.keys } });
    const rotated = await f.store.rotate("alice", g.grant.id, 1);
    expect(rotated.revision).toBe(2);
    expect(
      await rejectionOf(f.store.openAccess("alice", g.grant.id, 1)),
    ).toMatchObject({ id: "mcp_oauth_conflict" });
    expect(
      (await f.store.openAccess("alice", g.grant.id, 2)) === expected,
    ).toBe(true);
    const { exportOwnedAccount } = await import(
      "@/lib/actions/account/account"
    );
    const exported = (await exportOwnedAccount("alice")).mcpOAuthGrants;
    expect(exported).toEqual([rotated]);
    const serialized = JSON.stringify(exported);
    for (const word of [
      "ciphertext",
      "nonce",
      "stateHash",
      "verifier",
      "https:",
      "synthetic-access",
      "synthetic-refresh",
    ])
      expect(serialized.includes(word)).toBe(false);
  });
  test("refresh single-flight/cancel fence, one committed entry/replacement, stale claims never overwrite rotated tokens", async () => {
    const f = get(),
      g = await f.grant(),
      binding = await f.bind("oauth.refresh");
    const first = await f.store.reserveRefresh("alice", {
      id: crypto.randomUUID(),
      grantId: g.grant.id,
      expectedRevision: 1,
      bindingId: binding.id,
    });
    expect(
      await rejectionOf(
        f.store.reserveRefresh("alice", {
          id: crypto.randomUUID(),
          grantId: g.grant.id,
          expectedRevision: 2,
          bindingId: binding.id,
        }),
      ),
    ).toMatchObject({ id: "mcp_oauth_refresh_busy" });
    expect(
      await rejectionOf(f.store.rotate("alice", g.grant.id, 2)),
    ).toMatchObject({ id: "mcp_oauth_refresh_busy" });
    await f.store.cancelRefresh("alice", first.id, 1);
    const second = await f.store.reserveRefresh("alice", {
      id: crypto.randomUUID(),
      grantId: g.grant.id,
      expectedRevision: 2,
      bindingId: binding.id,
    });
    expect(second.fence).toBe(2);
    const entered = await f.store.enterRefresh("alice", second.id, 1);
    expect(entered.refreshToken === g.input.refreshToken).toBe(true);
    expect(
      await rejectionOf(f.store.enterRefresh("alice", second.id, 2)),
    ).toMatchObject({ id: "mcp_oauth_refresh_replay" });
    expect(
      await rejectionOf(f.store.cancelRefresh("alice", second.id, 2)),
    ).toMatchObject({ id: "mcp_oauth_entry_not_disproved" });
    const replacement = {
      accessToken: "synthetic-replacement-access",
      refreshToken: "synthetic-replacement-refresh",
      expiresAt: g.input.expiresAt,
    };
    const replaced = await f.store.replaceFixtureRefresh(
      "alice",
      second.id,
      2,
      replacement,
    );
    expect(replaced.revision).toBe(4);
    expect(
      (await f.store.openAccess("alice", g.grant.id, 4)) ===
        replacement.accessToken,
    ).toBe(true);
    expect(
      await rejectionOf(
        f.store.replaceFixtureRefresh("alice", second.id, 3, replacement),
      ),
    ).toMatchObject({ id: "mcp_oauth_refresh_replay" });
    expect(
      await rejectionOf(f.store.enterRefresh("alice", first.id, 2)),
    ).toMatchObject({ id: "mcp_oauth_refresh_replay" });
    expect(f.seen).toHaveLength(0);
  });
  test("entered refresh crash expires without replay; unknown blocks old token and survives local secret deletion", async () => {
    const f = get(),
      g = await f.grant(),
      binding = await f.bind("oauth.refresh"),
      claim = await f.store.reserveRefresh("alice", {
        id: crypto.randomUUID(),
        grantId: g.grant.id,
        expectedRevision: 1,
        bindingId: binding.id,
      });
    await f.store.enterRefresh("alice", claim.id, 1);
    f.setClock(new Date(Date.now() + 60000));
    expect(
      await rejectionOf(f.store.enterRefresh("alice", claim.id, 2)),
    ).toMatchObject({ id: "mcp_oauth_refresh_replay" });
    const production = createMcpOAuthStore({ db: f.db });
    await production.retainRefreshUnknown("alice", claim.id, 2);
    expect(
      await rejectionOf(f.store.openAccess("alice", g.grant.id, 3)),
    ).toMatchObject({ id: "mcp_oauth_secret_denied" });
    expect(
      await rejectionOf(
        f.store.reserveRefresh("alice", {
          id: crypto.randomUUID(),
          grantId: g.grant.id,
          expectedRevision: 3,
          bindingId: binding.id,
        }),
      ),
    ).toMatchObject({ id: "mcp_oauth_purpose_denied" });
    f.setEnv({ ...f.env, MCP_CLIENT_ENABLED: "0", GITHUB_INVITE_LOGINS: "" });
    await production.deleteBinding("alice", g.binding.id, 1);
    expect(await production.metadata("alice")).toEqual([]);
    const [retained] = await f.db.execute<{ count: number }>(
      sql`SELECT count(*)::integer AS count FROM mcp_oauth_record WHERE id=${`unknown:${claim.id}`}`,
    );
    expect(retained.count).toBe(1);
  });
  for (const change of [
    "clock",
    "invite",
    "profile",
    "manifest",
    "gate",
  ] as const)
    test(`last awaited PKCE write/final observation rejects ${change} drift with zero partial state`, async () => {
      const f = get(),
        binding = await f.bind();
      let wrote = false,
        changed = false;
      const prior = process.env.NODE_ENV;
      f.afterQuery((statement, result) => {
        if (statement.includes("INSERT INTO mcp_oauth_state")) wrote = true;
        if (!wrote || changed || !statement.includes("AS bindings_valid"))
          return;
        changed = true;
        if (change === "clock" && Array.isArray(result))
          for (const row of result)
            if (row && typeof row === "object" && "now" in row)
              Reflect.set(row, "now", new Date(Date.now() + 700000));
        if (change === "invite")
          f.setEnv({ ...f.env, GITHUB_INVITE_LOGINS: "bob" });
        if (change === "profile")
          f.setEnv({
            ...f.env,
            MCP_CLIENT_PROFILES_JSON: JSON.stringify(
              f.profiles.map((p) => ({ ...p, maxResponseBytes: 2000 })),
            ),
          });
        if (change === "manifest")
          f.setRuntime({
            ...f.runtime,
            manifests: f.runtime.manifests.map((m) => ({
              ...m,
              endpoint: "https://changed.example.com/token",
            })),
          });
        if (change === "gate")
          Reflect.set(process.env, "NODE_ENV", "production");
      });
      try {
        expect(await rejectionOf(f.state(binding.id))).toBeDefined();
      } finally {
        if (prior === undefined)
          Reflect.deleteProperty(process.env, "NODE_ENV");
        else Reflect.set(process.env, "NODE_ENV", prior);
        f.afterQuery(undefined);
      }
      expect(changed).toBe(true);
      const [row] = await f.db.execute<{ count: number }>(
        sql`SELECT count(*)::integer AS count FROM mcp_oauth_state`,
      );
      expect(row.count).toBe(0);
      const [counters] = await f.db.execute<{ count: number }>(
        sql`SELECT count(*)::integer AS count FROM mcp_oauth_record`,
      );
      expect(counters.count).toBe(1);
    });
  for (const cap of ["daily", "lifetime"] as const)
    test(`same GitHub principal retains ${cap} cap after account deletion and new user id`, async () => {
      const f = get();
      const admissions = cap === "daily" ? 10 : 1;
      for (let i = 0; i < admissions; i++) {
        const binding = await f.bind();
        await f.store.deleteBinding("alice", binding.id, 1);
      }
      if (cap === "lifetime") {
        const [record] = await f.db.execute<{ actor_key: string }>(
          sql`SELECT actor_key FROM mcp_oauth_record LIMIT 1`,
        );
        await f.db.execute(
          sql`INSERT INTO mcp_oauth_record(id,actor_key,kind,day) SELECT 'prior-lifetime-'||s,${record.actor_key},'binding','2020-01-01'::date FROM generate_series(1,99) s`,
        );
      }
      const before = await f.db.execute(
        sql`SELECT id,actor_key,kind,day,created_at FROM mcp_oauth_record ORDER BY id`,
      );
      const { deleteOwnedAccount } = await import(
        "@/lib/actions/account/account"
      );
      await deleteOwnedAccount("alice");
      await f.db.execute(
        sql`INSERT INTO "user"(id,name,email,email_verified,github_login) VALUES ('alice-rejoined','New local id','rejoined@example.invalid',true,'alice')`,
      );
      await f.db.execute(
        sql`INSERT INTO account(id,account_id,provider_id,user_id) VALUES ('oauth-github-rejoined',${f.githubAccounts.alice},'github','alice-rejoined')`,
      );
      expect(
        await f.db.execute(
          sql`SELECT id,actor_key,kind,day,created_at FROM mcp_oauth_record ORDER BY id`,
        ),
      ).toEqual(before);
      const connection = {
        id: crypto.randomUUID(),
        revision: crypto.randomUUID(),
      };
      f.connections.set("alice-rejoined", connection);
      await f.db.execute(
        sql`INSERT INTO mcp_connection(id,user_id,profile_id,profile_revision,purpose,profile_digest,label,state,revision) VALUES (${connection.id},'alice-rejoined','anchor','v1','mcp.call',${"a".repeat(64)},'Synthetic rejoined owner','configured',${connection.revision})`,
      );
      expect(
        await rejectionOf(f.bind("oauth.token", "alice-rejoined")),
      ).toMatchObject({ id: "mcp_oauth_record_limit" });
      const after = await f.db.execute(
        sql`SELECT id,actor_key,kind,day,created_at FROM mcp_oauth_record ORDER BY id`,
      );
      expect(after).toEqual(before);
      expect(await f.store.metadata("alice-rejoined")).toEqual([]);
    });
  for (const identity of [
    "missing",
    "ambiguous",
    "leading-zero",
    "non-numeric",
    "foreign-provider",
  ] as const)
    test(`OAuth admission denies ${identity} GitHub principal without partial counters`, async () => {
      const f = get();
      if (identity === "missing")
        await f.db.execute(sql`DELETE FROM account WHERE user_id='alice'`);
      if (identity === "ambiguous")
        await f.db.execute(
          sql`INSERT INTO account(id,account_id,provider_id,user_id) VALUES ('oauth-extra-github','10003','github','alice')`,
        );
      if (identity === "leading-zero")
        await f.db.execute(
          sql`UPDATE account SET account_id='010001' WHERE user_id='alice'`,
        );
      if (identity === "non-numeric")
        await f.db.execute(
          sql`UPDATE account SET account_id='mutable-login-name' WHERE user_id='alice'`,
        );
      if (identity === "foreign-provider")
        await f.db.execute(
          sql`UPDATE account SET provider_id='other' WHERE user_id='alice'`,
        );
      expect(await rejectionOf(f.bind())).toMatchObject({
        id: "mcp_oauth_principal_unavailable",
      });
      const [rows] = await f.db.execute<{ records: number; bindings: number }>(
        sql`SELECT (SELECT count(*)::integer FROM mcp_oauth_record) AS records,(SELECT count(*)::integer FROM mcp_oauth_binding) AS bindings`,
      );
      expect(rows).toEqual({ records: 0, bindings: 0 });
    });
  test("admission rechecks exact GitHub principal after the owner-lock await", async () => {
    const f = get();
    let changed = false;
    f.afterQuery(async (statement, _result, tx) => {
      if (
        changed ||
        !statement.includes('FROM "user" WHERE id=') ||
        !statement.includes("FOR UPDATE")
      )
        return;
      changed = true;
      await tx.execute(
        sql`INSERT INTO account(id,account_id,provider_id,user_id) VALUES ('oauth-after-lock','10004','github','alice')`,
      );
    });
    expect(await rejectionOf(f.bind())).toMatchObject({
      id: "mcp_oauth_principal_unavailable",
    });
    f.afterQuery(undefined);
    expect(changed).toBe(true);
    const [row] = await f.db.execute<{ records: number; accounts: number }>(
      sql`SELECT (SELECT count(*)::integer FROM mcp_oauth_record) AS records,(SELECT count(*)::integer FROM account WHERE user_id='alice') AS accounts`,
    );
    expect(row).toEqual({ records: 0, accounts: 1 });
  });
  test("mutable GitHub login label is not an admission counter identity", async () => {
    const f = get();
    for (let i = 0; i < 10; i++) {
      const binding = await f.bind();
      await f.store.deleteBinding("alice", binding.id, 1);
    }
    f.setEnv({ ...f.env, GITHUB_INVITE_LOGINS: "renamed,bob" });
    await f.db.execute(
      sql`UPDATE "user" SET github_login='renamed' WHERE id='alice'`,
    );
    expect(await rejectionOf(f.bind())).toMatchObject({
      id: "mcp_oauth_record_limit",
    });
  });
  test("metadata driver failures return fixed AppError without raw SQL/cause and need no admission keys", async () => {
    const f = get(),
      raw = Object.assign(
        new Error("synthetic driver SQL and not-real-secret marker"),
        {
          code: "XX000",
          query: "SELECT synthetic-private-data",
          cause: new Error("synthetic nested detail"),
        },
      );
    const driver = new Proxy(f.db, {
      get(target, key, receiver) {
        if (key === "execute")
          return async () => {
            throw raw;
          };
        return Reflect.get(target, key, receiver);
      },
    });
    const store = createMcpOAuthStore({ db: driver }),
      error = await rejectionOf(store.metadata("alice"));
    const { AppError } = await import("@/lib/errors");
    expect(error instanceof AppError).toBe(true);
    expect(error !== raw).toBe(true);
    expect(
      error &&
        typeof error === "object" &&
        "message" in error &&
        error.message === "mcp_oauth_storage_unavailable",
    ).toBe(true);
    expect(
      error &&
        typeof error === "object" &&
        !Reflect.has(error, "cause") &&
        !Reflect.has(error, "query"),
    ).toBe(true);
  });
  test("retained admission counters cannot be reset by deletion or counter-secret rotation", async () => {
    const f = get();
    for (let i = 0; i < 10; i++) {
      const binding = await f.bind();
      await f.store.deleteBinding("alice", binding.id, 1);
    }
    expect(await rejectionOf(f.bind())).toMatchObject({
      id: "mcp_oauth_record_limit",
    });
    f.setRuntime({
      ...f.runtime,
      counterSecret: "changed-counter-secret-cannot-reset-existing-counters",
    });
    expect(await rejectionOf(f.bind())).toMatchObject({
      id: "mcp_oauth_counter_rotation_unknown",
    });
    const [row] = await f.db.execute<{ count: number }>(
      sql`SELECT count(*)::integer AS count FROM mcp_oauth_record`,
    );
    expect(row.count).toBe(10);
  });
  test("account/connection deletion erases secrets but retains anonymous entered-refresh uncertainty", async () => {
    const f = get(),
      g = await f.grant(),
      binding = await f.bind("oauth.refresh"),
      claim = await f.store.reserveRefresh("alice", {
        id: crypto.randomUUID(),
        grantId: g.grant.id,
        expectedRevision: 1,
        bindingId: binding.id,
      });
    await f.store.enterRefresh("alice", claim.id, 1);
    const { deleteOwnedAccount } = await import(
      "@/lib/actions/account/account"
    );
    await deleteOwnedAccount("alice");
    const [row] = await f.db.execute<{
      grants: number;
      states: number;
      bindings: number;
      claims: number;
      unknown: number;
    }>(
      sql`SELECT (SELECT count(*)::integer FROM mcp_oauth_grant) AS grants,(SELECT count(*)::integer FROM mcp_oauth_state) AS states,(SELECT count(*)::integer FROM mcp_oauth_binding) AS bindings,(SELECT count(*)::integer FROM mcp_oauth_refresh) AS claims,(SELECT count(*)::integer FROM mcp_oauth_record WHERE kind='unknown') AS unknown`,
    );
    expect(row).toEqual({
      grants: 0,
      states: 0,
      bindings: 0,
      claims: 0,
      unknown: 1,
    });
  });
  test("SQL guards reject intended immutable/state/secret violations without FK or NULL-check false positives", async () => {
    const f = get(),
      g = await f.grant(),
      binding = await f.bind("oauth.refresh"),
      claim = await f.store.reserveRefresh("alice", {
        id: crypto.randomUUID(),
        grantId: g.grant.id,
        expectedRevision: 1,
        bindingId: binding.id,
      });
    for (const statement of [
      `UPDATE mcp_oauth_binding SET manifest_digest='${"0".repeat(64)}'`,
      "UPDATE mcp_oauth_state SET state='pending',revision=revision+1",
      "UPDATE mcp_oauth_refresh SET state='replaced',revision=revision+1",
      "UPDATE mcp_oauth_grant SET revision=revision+2",
      "DELETE FROM mcp_oauth_record",
    ]) {
      const error = await f.db.$client
        .unsafe(statement)
        .simple()
        .then(
          () => {
            throw new Error("OAuth SQL guard unexpectedly accepted mutation");
          },
          (e: unknown) => e,
        );
      expect(error).toMatchObject({
        code: "P0001",
        message: expect.stringContaining("mcp oauth"),
      });
    }
    for (const secret of [
      "{}",
      "null",
      "[]",
      '{"keyVersion":"v1","nonce":"AAAAAAAAAAAAAAAA","ciphertext":null}',
    ]) {
      const error = await f.db.$client
        .unsafe(
          `UPDATE mcp_oauth_grant SET access_secret='${secret}'::jsonb,revision=revision+1 WHERE id='${g.grant.id}'`,
        )
        .simple()
        .then(
          () => {
            throw new Error("Invalid encrypted secret unexpectedly accepted");
          },
          (e: unknown) => e,
        );
      expect(error).toMatchObject({
        code: "23514",
        message: expect.stringContaining("mcp_oauth_grant_secrets"),
      });
      expect((await f.store.metadata("alice"))[0].revision).toBe(2);
      expect(
        (await f.store.openAccess("alice", g.grant.id, 2)) ===
          g.input.accessToken,
      ).toBe(true);
    }
    expect((await f.store.refreshStatus("alice", claim.id)).state).toBe(
      "reserved",
    );
    expect((await f.store.metadata("alice"))[0].revision).toBe(2);
  });
  test("caller mutation after lock wait cannot change the owned PKCE input snapshot", async () => {
    const f = get(),
      binding = await f.bind(),
      input = {
        bindingId: binding.id,
        expectedBindingRevision: 1,
        session: "alice-session",
        redirectUri: f.manifests[0].redirectUri,
      };
    let changed = false;
    f.afterQuery((statement) => {
      if (changed || !statement.includes("pg_advisory_xact_lock")) return;
      changed = true;
      input.bindingId = crypto.randomUUID();
      input.session = "bob-session";
      input.redirectUri = "https://evil.example.com/callback";
    });
    const state = await f.store.beginState("alice", input);
    f.afterQuery(undefined);
    expect(changed).toBe(true);
    const consumed = await f.store.consumeState("alice", {
      state: state.state,
      session: "alice-session",
      redirectUri: f.manifests[0].redirectUri,
    });
    expect(consumed.bindingId).toBe(binding.id);
  });
  test("expired grant cannot expose either token or start/enter refresh", async () => {
    const f = get(),
      g = await f.grant(),
      binding = await f.bind("oauth.refresh");
    f.setClock(new Date(Date.now() + 3601000));
    expect(
      await rejectionOf(f.store.openAccess("alice", g.grant.id, 1)),
    ).toMatchObject({ id: "mcp_oauth_expired" });
    expect(
      await rejectionOf(
        f.store.reserveRefresh("alice", {
          id: crypto.randomUUID(),
          grantId: g.grant.id,
          expectedRevision: 1,
          bindingId: binding.id,
        }),
      ),
    ).toMatchObject({ id: "mcp_oauth_expired" });
    expect((await f.store.metadata("alice"))[0].revision).toBe(1);
  });
  test("pending state and active grant bounds are enforced independently by SQL", async () => {
    const f = get(),
      g = await f.grant();
    const next = await f.state(g.binding.id);
    expect(await rejectionOf(f.state(g.binding.id))).toMatchObject({
      id: "mcp_oauth_storage_conflict",
    });
    const duplicate = await f.db.$client
      .unsafe(
        `INSERT INTO mcp_oauth_state(id,user_id,binding_id,connection_id,state_hash,session_hash,redirect_uri,verifier,challenge,state,revision,expires_at,created_at) SELECT '${crypto.randomUUID()}',user_id,binding_id,connection_id,'${"f".repeat(64)}',session_hash,redirect_uri,verifier,challenge,state,revision,expires_at,created_at FROM mcp_oauth_state WHERE id='${next.id}'`,
      )
      .simple()
      .then(
        () => {
          throw new Error("Pending PKCE connection cap unexpectedly bypassed");
        },
        (e: unknown) => e,
      );
    expect(duplicate).toMatchObject({
      code: "23505",
      message: expect.stringContaining("mcp_oauth_state_current"),
    });
    const consumed = await f.store.consumeState("alice", {
      state: next.state,
      session: "alice-session",
      redirectUri: f.manifests[0].redirectUri,
    });
    expect(
      await rejectionOf(
        f.store.installFixtureGrant("alice", {
          ...g.input,
          id: crypto.randomUUID(),
          stateId: consumed.id,
          expectedStateRevision: consumed.revision,
        }),
      ),
    ).toMatchObject({ id: "mcp_oauth_storage_conflict" });
    expect(await f.store.metadata("alice")).toHaveLength(1);
  });
  test("expired session/state and changed connection/profile revoke callback usability", async () => {
    const f = get(),
      binding = await f.bind(),
      pending = await f.state(binding.id),
      callback = {
        state: pending.state,
        session: "alice-session",
        redirectUri: f.manifests[0].redirectUri,
      };
    f.setClock(new Date(Date.now() + 700000));
    expect(
      await rejectionOf(f.store.consumeState("alice", callback)),
    ).toMatchObject({ id: "mcp_oauth_expired" });
    f.setClock(undefined);
    await f.db.execute(
      sql`UPDATE session SET expires_at=clock_timestamp()-interval '1 second' WHERE id='alice-session'`,
    );
    expect(
      await rejectionOf(f.store.consumeState("alice", callback)),
    ).toMatchObject({ id: "mcp_oauth_session_changed" });
    await f.db.execute(
      sql`UPDATE session SET expires_at=clock_timestamp()+interval '1 day' WHERE id='alice-session'`,
    );
    await f.db.execute(
      sql`UPDATE mcp_connection SET revision=${crypto.randomUUID()} WHERE id=${f.connections.get("alice")?.id}`,
    );
    expect(
      await rejectionOf(f.store.consumeState("alice", callback)),
    ).toMatchObject({ id: "mcp_oauth_binding_changed" });
    const [row] = await f.db.execute<{ state: string }>(
      sql`SELECT state FROM mcp_oauth_state WHERE id=${pending.id}`,
    );
    expect(row.state).toBe("pending");
  });
  for (const phase of ["enter", "replace"] as const)
    for (const change of ["clock", "invite", "token-profile", "gate"] as const)
      test(`${phase} final refresh observation catches ${change} drift and rolls back`, async () => {
        const f = get(),
          g = await f.grant(),
          binding = await f.bind("oauth.refresh"),
          claim = await f.store.reserveRefresh("alice", {
            id: crypto.randomUUID(),
            grantId: g.grant.id,
            expectedRevision: 1,
            bindingId: binding.id,
          });
        if (phase === "replace")
          await f.store.enterRefresh("alice", claim.id, 1);
        let wrote = false,
          changed = false;
        const prior = process.env.NODE_ENV;
        f.afterQuery((statement, result) => {
          if (
            statement.includes(
              phase === "enter"
                ? "SET state='entered'"
                : "SET state='replaced'",
            )
          )
            wrote = true;
          if (!wrote || changed || !statement.includes("b2.id")) return;
          changed = true;
          if (change === "clock" && Array.isArray(result))
            for (const row of result)
              if (row && typeof row === "object" && "now" in row)
                Reflect.set(row, "now", new Date(Date.now() + 60000));
          if (change === "invite")
            f.setEnv({ ...f.env, GITHUB_INVITE_LOGINS: "bob" });
          if (change === "token-profile")
            f.setEnv({
              ...f.env,
              MCP_CLIENT_PROFILES_JSON: JSON.stringify(
                f.profiles.map((p) =>
                  p.purpose === "oauth.token"
                    ? { ...p, maxResponseBytes: 2000 }
                    : p,
                ),
              ),
            });
          if (change === "gate")
            Reflect.set(process.env, "NODE_ENV", "production");
        });
        try {
          expect(
            await rejectionOf(
              phase === "enter"
                ? f.store.enterRefresh("alice", claim.id, 1)
                : f.store.replaceFixtureRefresh("alice", claim.id, 2, {
                    accessToken: "synthetic-new-access",
                    refreshToken: "synthetic-new-refresh",
                    expiresAt: g.input.expiresAt,
                  }),
            ),
          ).toBeDefined();
        } finally {
          if (prior === undefined)
            Reflect.deleteProperty(process.env, "NODE_ENV");
          else Reflect.set(process.env, "NODE_ENV", prior);
          f.afterQuery(undefined);
        }
        expect(changed).toBe(true);
        expect((await f.store.refreshStatus("alice", claim.id)).state).toBe(
          phase === "enter" ? "reserved" : "entered",
        );
        expect((await f.store.metadata("alice"))[0].revision).toBe(2);
      });
  for (const cap of ["owner-records", "global-records", "global-day"] as const)
    test(`${cap} retained bound denies admission before partial binding`, async () => {
      const f = get(),
        binding = await f.bind();
      await f.store.deleteBinding("alice", binding.id, 1);
      const [record] = await f.db.execute<{ actor_key: string }>(
        sql`SELECT actor_key FROM mcp_oauth_record LIMIT 1`,
      );
      const count =
        cap === "owner-records" ? 99 : cap === "global-records" ? 999 : 49;
      const actor = cap === "owner-records" ? record.actor_key : "0".repeat(64);
      await f.db.execute(
        sql`INSERT INTO mcp_oauth_record(id,actor_key,kind,day) SELECT 'bounded-fixture-'||s,${actor},'binding',CASE WHEN ${cap}='global-day' THEN (clock_timestamp() AT TIME ZONE 'UTC')::date ELSE '2020-01-01'::date END FROM generate_series(1,${count}) s`,
      );
      expect(await rejectionOf(f.bind())).toMatchObject({
        id: "mcp_oauth_record_limit",
      });
      const [rows] = await f.db.execute<{ count: number }>(
        sql`SELECT count(*)::integer AS count FROM mcp_oauth_binding`,
      );
      expect(rows.count).toBe(0);
    });
});
test("0020 local upgrade after 0018 preserves anonymous financial operations, receipts and frozen carry (0019 integration separate)", async () => {
  const engine = await PGlite.create();
  try {
    for (const file of readdirSync("drizzle")
      .filter((f) => f.endsWith(".sql") && f < "0020")
      .sort())
      await engine.exec(readFileSync(`drizzle/${file}`, "utf8"));
    await engine.exec(
      `INSERT INTO mcp_operation(id,actor_key,actor_version,idempotency_key,binding_digest,identity,fee_snapshot,month,day,state,reserved_microdollars,incurred_microdollars,attempts,deadline,receipt_id,receipt) VALUES ('00000000-0000-4000-8000-000000000001','${"a".repeat(64)}','v1','legacy','${"b".repeat(64)}','{}','{}','2026-01','2026-01-01','settled',10000,5000,1,'2026-01-01','00000000-0000-4000-8000-000000000002','{"id":"00000000-0000-4000-8000-000000000002","operationId":"00000000-0000-4000-8000-000000000001","bindingDigest":"${"b".repeat(64)}","evidenceDigest":"${"c".repeat(64)}","incurredMicrodollars":5000,"terminal":true,"revision":"v1"}'); INSERT INTO mcp_operation_period(month,plan_identity,sources_digest) VALUES ('2026-02','{}','${"d".repeat(64)}'); INSERT INTO mcp_operation_commitment(month,source_id,amount_microdollars) VALUES ('2026-02','00000000-0000-4000-8000-000000000001',10000)`,
    );
    await engine.exec(
      "INSERT INTO credit_reservation(id,actor_key,actor_kind,idempotency_key,request_digest,day,month,reserved_microdollars,charged_microdollars,incurred_microdollars,state,price_snapshot) VALUES ('oauth-upgrade-credit','anonymous-legacy','guest','once','digest','2026-01-01','2026-01',500000,500000,100000,'held','{}'); INSERT INTO guest_usage(actor_key,reservation_id) VALUES ('anonymous-legacy','oauth-upgrade-credit'); INSERT INTO byok_operation(id,actor_key,provider,credential_revision,kind,digest,state) VALUES ('oauth-upgrade-byok','anonymous-legacy','openrouter','legacy','chat','digest','held')",
    );
    const creditBefore = await engine.query(
        "SELECT row_to_json(r) AS value FROM credit_reservation r",
      ),
      byokBefore = await engine.query(
        "SELECT row_to_json(r) AS value FROM byok_operation r",
      );
    const before = await engine.query(
      "SELECT row_to_json(o) AS value FROM mcp_operation o",
    );
    await engine.exec(readFileSync("drizzle/0020_mcp_oauth_state.sql", "utf8"));
    expect(
      (
        await engine.query(
          "SELECT row_to_json(o) AS value FROM mcp_operation o",
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await engine.query(
          "SELECT amount_microdollars FROM mcp_operation_commitment",
        )
      ).rows,
    ).toEqual([{ amount_microdollars: 10000 }]);
    expect(
      (
        await engine.query(
          "SELECT row_to_json(r) AS value FROM credit_reservation r",
        )
      ).rows,
    ).toEqual(creditBefore.rows);
    expect(
      (
        await engine.query(
          "SELECT row_to_json(r) AS value FROM byok_operation r",
        )
      ).rows,
    ).toEqual(byokBefore.rows);
    expect(
      (await engine.query("SELECT count(*)::integer AS count FROM guest_usage"))
        .rows,
    ).toEqual([{ count: 1 }]);
    const rls = await engine.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname IN ('mcp_oauth_binding','mcp_oauth_state','mcp_oauth_grant','mcp_oauth_refresh','mcp_oauth_record','mcp_oauth_counter_key')",
    );
    expect(rls.rows).toHaveLength(6);
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);
  } finally {
    await engine.close();
  }
});
