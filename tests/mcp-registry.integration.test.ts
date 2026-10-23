import { describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import type { McpReviewedProfile } from "../lib/mcp/config";

mock.module("server-only", () => ({}));

const { resourceActor } = await import("@/lib/byok/config");
const { lockByokResources } = await import("@/lib/byok/store");
const { resolveMcpClientConfig } = await import("../lib/mcp/config");
const { McpRegistryStore } = await import("../lib/mcp/registry-store");
const { MCP_REGISTRY_LIMITS, computeProfileDigest } = await import(
  "../lib/mcp/registry-contract"
);
const { exportOwnedAccount, deleteOwnedAccount } = await import(
  "../lib/actions/account/account"
);
const { betaFixture } = await import("./helpers/beta-fixture");
const { rejectionOf } = await import("./helpers/rejection");

function makeTestProfile(
  overrides: Partial<McpReviewedProfile> = {},
): McpReviewedProfile {
  return Object.freeze({
    profileId: "test-profile",
    revision: "v1",
    purpose: "mcp.list",
    resource: "https://mcp.example.com/api",
    issuer: "https://auth.example.com/",
    credential: "none",
    maxRequestBytes: 4096,
    maxResponseBytes: 16384,
    timeoutMs: 5000,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  });
}

function makeRealConfig(
  profiles: McpReviewedProfile[],
  clock = () => Date.now(),
) {
  const envConfig: Record<string, string> = {
    MCP_CLIENT_ENABLED: "1",
    MCP_CLIENT_BROKER_URL: "https://broker.example.com/v1/egress",
    MCP_CLIENT_HMAC_KEY: Buffer.alloc(32, 1).toString("base64"),
    MCP_CLIENT_ENVELOPE_KEY: Buffer.alloc(32, 2).toString("base64"),
    MCP_CLIENT_PROFILES_JSON: JSON.stringify(profiles),
  };
  const binding = {
    fetch: async () => {
      throw new Error("unexpected_network_call_in_registry");
    },
  };
  return resolveMcpClientConfig({
    env: envConfig,
    binding,
    now: clock,
  });
}

type CountRow = { count: number | string };
type StateRow = {
  id: string;
  state: string;
  reserved_microdollars: number | null;
  actual_microdollars: number | null;
  receipt_credits: number | null;
};
type SecurityRow = { tablename: string; rowsecurity: boolean };

describe("MCP Connection Registry Integration Suite", () => {
  test("1. populated 0013 -> 0014 upgrade preserving search/image holds/tables", async () => {
    const standaloneDb = await PGlite.create();
    try {
      const files = readdirSync("drizzle")
        .filter((name) => name.endsWith(".sql"))
        .sort();

      // Apply 0000 through 0013 only
      for (const file of files) {
        if (file > "0013_image_artifacts.sql") break;
        await standaloneDb.exec(readFileSync(`drizzle/${file}`, "utf8"));
      }

      // Populate pre-0014 data: user, chat, chat_message, artifact, search credential, and holds
      await standaloneDb.exec(`
        INSERT INTO "user"(id, name, email, email_verified, github_login)
        VALUES ('u1', 'User 1', 'u1@example.invalid', true, 'u1');

        INSERT INTO chat(id, user_id, title)
        VALUES ('chat-1', 'u1', 'Pre-0014 Chat');

        INSERT INTO chat_message(id, chat_id, user_id, role, parts, attachments)
        VALUES ('msg-1', 'chat-1', 'u1', 'user', '[]'::jsonb, '[]'::jsonb);

        INSERT INTO artifact(id, user_id, chat_id, message_id, kind, head)
        VALUES ('art-1', 'u1', 'chat-1', 'msg-1', 'image', 1);

        INSERT INTO artifact_revision(artifact_id, user_id, version, title, content)
        VALUES ('art-1', 'u1', 1, 'Pre-0014 Artifact Revision', 'test-content');

        INSERT INTO search_credential(user_id, provider, revision, key_version, nonce, ciphertext, masked_key)
        VALUES ('u1', 'tavily', 'rev-1', 'v1', 'nonce-1', 'cipher-1', 'tvly-****');

        INSERT INTO byok_operation(id, actor_key, provider, credential_revision, kind, digest, state, price_revision, reserved_microdollars, actual_microdollars, receipt_credits)
        VALUES ('op-search-hold', 'actor-u1', 'tavily', 'rev-1', 'search', 'digest-search', 'held', 'price-search-1', 10000, 10000, 1);

        INSERT INTO byok_operation(id, actor_key, provider, credential_revision, kind, digest, state)
        VALUES ('op-image-hold', 'actor-u1', 'openrouter', 'rev-1', 'image', 'digest-img', 'held');

        INSERT INTO image_generation(id, user_id, chat_id, message_id, artifact_id, expected_head, request, model_snapshot, state, cancelled)
        VALUES ('gen-1', 'u1', 'chat-1', 'msg-1', 'art-1', 1, '{"prompt":"test"}'::jsonb, '{"id":"model-1"}'::jsonb, 'held', false);
      `);

      // Verify pre-0014 exact states and held financial amounts
      const preSearch = await standaloneDb.query<CountRow>(
        "SELECT count(*)::integer AS count FROM search_credential WHERE user_id = 'u1'",
      );
      expect(Number(preSearch.rows[0].count)).toBe(1);

      const preSearchHold = await standaloneDb.query<StateRow>(
        "SELECT id, state, reserved_microdollars, actual_microdollars, receipt_credits FROM byok_operation WHERE id = 'op-search-hold'",
      );
      expect(preSearchHold.rows).toHaveLength(1);
      expect(preSearchHold.rows[0].state).toBe("held");
      expect(preSearchHold.rows[0].reserved_microdollars).toBe(10000);
      expect(preSearchHold.rows[0].actual_microdollars).toBe(10000);
      expect(preSearchHold.rows[0].receipt_credits).toBe(1);

      const preImageHold = await standaloneDb.query<StateRow>(
        "SELECT id, state, reserved_microdollars, actual_microdollars, receipt_credits FROM byok_operation WHERE id = 'op-image-hold'",
      );
      expect(preImageHold.rows).toHaveLength(1);
      expect(preImageHold.rows[0].state).toBe("held");
      expect(preImageHold.rows[0].reserved_microdollars).toBeNull();
      expect(preImageHold.rows[0].actual_microdollars).toBeNull();

      const preGen = await standaloneDb.query<StateRow>(
        "SELECT id, state FROM image_generation WHERE id = 'gen-1'",
      );
      expect(preGen.rows).toHaveLength(1);
      expect(preGen.rows[0].state).toBe("held");

      // Apply 0014
      await standaloneDb.exec(
        readFileSync("drizzle/0014_mcp_connections.sql", "utf8"),
      );

      // Verify search credentials, image generations, and financial holds are completely intact
      const postSearch = await standaloneDb.query<CountRow>(
        "SELECT count(*)::integer AS count FROM search_credential WHERE user_id = 'u1'",
      );
      expect(Number(postSearch.rows[0].count)).toBe(1);

      const postSearchHold = await standaloneDb.query<StateRow>(
        "SELECT id, state, reserved_microdollars, actual_microdollars, receipt_credits FROM byok_operation WHERE id = 'op-search-hold'",
      );
      expect(postSearchHold.rows).toHaveLength(1);
      expect(postSearchHold.rows[0].state).toBe("held");
      expect(postSearchHold.rows[0].reserved_microdollars).toBe(10000);
      expect(postSearchHold.rows[0].actual_microdollars).toBe(10000);
      expect(postSearchHold.rows[0].receipt_credits).toBe(1);

      const postImageHold = await standaloneDb.query<StateRow>(
        "SELECT id, state, reserved_microdollars, actual_microdollars, receipt_credits FROM byok_operation WHERE id = 'op-image-hold'",
      );
      expect(postImageHold.rows).toHaveLength(1);
      expect(postImageHold.rows[0].state).toBe("held");
      expect(postImageHold.rows[0].reserved_microdollars).toBeNull();
      expect(postImageHold.rows[0].actual_microdollars).toBeNull();

      const postGen = await standaloneDb.query<StateRow>(
        "SELECT id, state FROM image_generation WHERE id = 'gen-1'",
      );
      expect(postGen.rows).toHaveLength(1);
      expect(postGen.rows[0].state).toBe("held");

      // Verify mcp_connection table exists and has RLS enabled
      const tableCheck = await standaloneDb.query<SecurityRow>(
        "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'mcp_connection'",
      );
      expect(tableCheck.rows).toHaveLength(1);
      expect(tableCheck.rows[0].rowsecurity).toBe(true);

      // Verify SQL constraints: invalid UUID rejected
      expect(
        standaloneDb.exec(`
          INSERT INTO mcp_connection (id, user_id, profile_id, profile_revision, purpose, profile_digest, label, state, revision)
          VALUES ('not-a-uuid', 'u1', 'p1', 'v1', 'mcp.list', '${"a".repeat(64)}', 'Label', 'configured', '${crypto.randomUUID()}');
        `),
      ).rejects.toThrow();

      // Verify SQL constraints: untrimmed label rejected
      expect(
        standaloneDb.exec(`
          INSERT INTO mcp_connection (id, user_id, profile_id, profile_revision, purpose, profile_digest, label, state, revision)
          VALUES ('${crypto.randomUUID()}', 'u1', 'p1', 'v1', 'mcp.list', '${"a".repeat(64)}', '  Untrimmed  ', 'configured', '${crypto.randomUUID()}');
        `),
      ).rejects.toThrow();

      // Verify SQL constraints: invalid purpose rejected
      expect(
        standaloneDb.exec(`
          INSERT INTO mcp_connection (id, user_id, profile_id, profile_revision, purpose, profile_digest, label, state, revision)
          VALUES ('${crypto.randomUUID()}', 'u1', 'p1', 'v1', 'oauth.token', '${"a".repeat(64)}', 'Label', 'configured', '${crypto.randomUUID()}');
        `),
      ).rejects.toThrow();
    } finally {
      await standaloneDb.close();
    }
  });

  test("2. owner CRUD + foreign 404", async () => {
    const fixture = await betaFixture();
    const profile = makeTestProfile();
    const config = makeRealConfig([profile]);
    const store = new McpRegistryStore(fixture.db, () => config);

    // Create by Alice
    const created = await store.create("alice", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: profile.purpose as "mcp.list",
      label: "Alice Connection",
    });

    expect(created.id).toBeDefined();
    expect(created.label).toBe("Alice Connection");
    expect(created.state).toBe("configured");
    expect(created.profileDigest).toBe(computeProfileDigest(profile));

    // Read by Alice
    const fetched = await store.get("alice", created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.revision).toBe(created.revision);

    // List by Alice
    const listAlice = await store.list("alice");
    expect(listAlice.some((c) => c.id === created.id)).toBe(true);

    // Foreign 404 for Bob
    expect(await rejectionOf(store.get("bob", created.id))).toMatchObject({
      id: "not_found",
      status: 404,
    });
    expect(
      await rejectionOf(store.disable("bob", created.id, created.revision)),
    ).toMatchObject({
      id: "not_found",
      status: 404,
    });
    expect(
      await rejectionOf(store.enable("bob", created.id, created.revision)),
    ).toMatchObject({
      id: "not_found",
      status: 404,
    });
    expect(
      await rejectionOf(store.revoke("bob", created.id, created.revision)),
    ).toMatchObject({
      id: "not_found",
      status: 404,
    });
    expect(
      await rejectionOf(
        store.updateLabel("bob", created.id, created.revision, "Stolen"),
      ),
    ).toMatchObject({
      id: "not_found",
      status: 404,
    });
    expect(
      await rejectionOf(store.delete("bob", created.id, created.revision)),
    ).toMatchObject({
      id: "not_found",
      status: 404,
    });

    // Alice mutates: disable -> enable -> delete
    const disabled = await store.disable("alice", created.id, created.revision);
    expect(disabled.state).toBe("disabled");
    expect(disabled.revision).not.toBe(created.revision);

    const enabled = await store.enable("alice", created.id, disabled.revision);
    expect(enabled.state).toBe("configured");
    expect(enabled.revision).not.toBe(disabled.revision);

    await store.delete("alice", created.id, enabled.revision);
    expect(await rejectionOf(store.get("alice", created.id))).toMatchObject({
      id: "not_found",
      status: 404,
    });
  });

  test("3. trimmed ASCII/multibyte 64-byte boundaries", async () => {
    const fixture = await betaFixture();
    const profile = makeTestProfile();
    const config = makeRealConfig([profile]);
    const store = new McpRegistryStore(fixture.db, () => config);

    // Empty or whitespace-only rejected
    expect(
      await rejectionOf(
        store.create("alice", {
          profileId: profile.profileId,
          profileRevision: profile.revision,
          purpose: "mcp.list",
          label: "    ",
        }),
      ),
    ).toMatchObject({ id: "invalid_label", status: 400 });

    // Trimming leading/trailing whitespace
    const trimmedConn = await store.create("alice", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "  Trimmed Label  ",
    });
    expect(trimmedConn.label).toBe("Trimmed Label");

    // Exactly 64 ASCII bytes: accepted
    const label64Ascii = "A".repeat(64);
    const conn64 = await store.create("alice", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: label64Ascii,
    });
    expect(conn64.label).toBe(label64Ascii);

    // 65 ASCII bytes: rejected
    const label65Ascii = "A".repeat(65);
    expect(
      await rejectionOf(
        store.create("alice", {
          profileId: profile.profileId,
          profileRevision: profile.revision,
          purpose: "mcp.list",
          label: label65Ascii,
        }),
      ),
    ).toMatchObject({ id: "invalid_label", status: 400 });

    // Multibyte 3-byte Euro (€) characters
    // 21 * 3 = 63 bytes + 1 ASCII byte 'X' = 64 bytes: accepted
    const label64Multi = `${"€".repeat(21)}X`;
    expect(Buffer.byteLength(label64Multi, "utf8")).toBe(64);
    const connMulti = await store.create("alice", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: label64Multi,
    });
    expect(connMulti.label).toBe(label64Multi);

    // 22 * 3 = 66 bytes: rejected
    const label66Multi = "€".repeat(22);
    expect(Buffer.byteLength(label66Multi, "utf8")).toBe(66);
    expect(
      await rejectionOf(
        store.create("alice", {
          profileId: profile.profileId,
          profileRevision: profile.revision,
          purpose: "mcp.list",
          label: label66Multi,
        }),
      ),
    ).toMatchObject({ id: "invalid_label", status: 400 });

    // Clean up created connections
    await store.delete("alice", trimmedConn.id, trimmedConn.revision);
    await store.delete("alice", conn64.id, conn64.revision);
    await store.delete("alice", connMulti.id, connMulti.revision);
  });

  test("4. sixth record blocked incl revoked", async () => {
    const fixture = await betaFixture();
    const profile = makeTestProfile();
    const config = makeRealConfig([profile]);
    const store = new McpRegistryStore(fixture.db, () => config);

    // Create 5 connections for Bob with mixed states
    const c1 = await store.create("bob", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "conn 1",
    });

    const c2 = await store.create("bob", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "conn 2",
    });

    const c3 = await store.create("bob", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "conn 3",
    });
    const c3Disabled = await store.disable("bob", c3.id, c3.revision);

    const c4 = await store.create("bob", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "conn 4",
    });
    const c4Revoked = await store.revoke("bob", c4.id, c4.revision);

    const c5 = await store.create("bob", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "conn 5",
    });

    // 6th record blocked even though c3 is disabled and c4 is revoked
    expect(
      await rejectionOf(
        store.create("bob", {
          profileId: profile.profileId,
          profileRevision: profile.revision,
          purpose: "mcp.list",
          label: "conn 6",
        }),
      ),
    ).toMatchObject({
      id: "mcp_connection_limit_exceeded",
      status: 400,
    });

    // Delete one with current revision, then creation of a 5th succeeds
    await store.delete("bob", c1.id, c1.revision);
    const replacement = await store.create("bob", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "replacement 5",
    });
    expect(replacement.id).toBeDefined();

    // Clean up Bob's connections
    await store.delete("bob", c2.id, c2.revision);
    await store.delete("bob", c3.id, c3Disabled.revision);
    await store.delete("bob", c4.id, c4Revoked.revision);
    await store.delete("bob", c5.id, c5.revision);
    await store.delete("bob", replacement.id, replacement.revision);
  });

  test("5. concurrent creates cap atomic", async () => {
    const fixture = await betaFixture();
    const profile = makeTestProfile();
    const config = makeRealConfig([profile]);
    const store = new McpRegistryStore(fixture.db, () => config);

    // Pre-create 4 connections for Bob
    const initialConns = [];
    for (let i = 1; i <= 4; i++) {
      const c = await store.create("bob", {
        profileId: profile.profileId,
        profileRevision: profile.revision,
        purpose: "mcp.list",
        label: `concurrent base ${i}`,
      });
      initialConns.push(c);
    }

    // Launch 2 simultaneous creates
    const p1 = store.create("bob", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "race A",
    });
    const p2 = store.create("bob", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "race B",
    });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const bobTotal = await store.list("bob");
    expect(bobTotal).toHaveLength(MCP_REGISTRY_LIMITS.maxConnectionsPerOwner);

    // Clean up
    for (const c of bobTotal) {
      await store.delete("bob", c.id, c.revision);
    }
  });

  test("6. expected revision CAS stale conflict", async () => {
    const fixture = await betaFixture();
    const profile = makeTestProfile();
    const config = makeRealConfig([profile]);
    const store = new McpRegistryStore(fixture.db, () => config);

    const conn = await store.create("alice", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "CAS Test",
    });
    const r0 = conn.revision;

    // Mutation with wrong revision fails
    expect(
      await rejectionOf(store.disable("alice", conn.id, "wrong-revision")),
    ).toMatchObject({
      id: "mcp_connection_cas_conflict",
      status: 409,
    });

    // Mutation with correct revision succeeds
    const disabled = await store.disable("alice", conn.id, r0);
    const r1 = disabled.revision;
    expect(r1).not.toBe(r0);

    // Using stale r0 now fails on enable and delete
    expect(await rejectionOf(store.enable("alice", conn.id, r0))).toMatchObject(
      {
        id: "mcp_connection_cas_conflict",
        status: 409,
      },
    );
    expect(await rejectionOf(store.delete("alice", conn.id, r0))).toMatchObject(
      {
        id: "mcp_connection_cas_conflict",
        status: 409,
      },
    );

    // Row in DB remains unchanged (disabled, revision r1)
    const stored = await store.get("alice", conn.id);
    expect(stored.state).toBe("disabled");
    expect(stored.revision).toBe(r1);

    // Delete with valid r1 succeeds
    await store.delete("alice", conn.id, r1);
  });

  test("7. revoked terminal", async () => {
    const fixture = await betaFixture();
    const profile = makeTestProfile();
    const config = makeRealConfig([profile]);
    const store = new McpRegistryStore(fixture.db, () => config);

    const conn = await store.create("alice", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "Revoked Test",
    });

    const revoked = await store.revoke("alice", conn.id, conn.revision);
    expect(revoked.state).toBe("revoked");

    // Idempotent re-revoke returns existing
    const revokedAgain = await store.revoke("alice", conn.id, revoked.revision);
    expect(revokedAgain.state).toBe("revoked");
    expect(revokedAgain.revision).toBe(revoked.revision);

    // Re-enable blocked
    expect(
      await rejectionOf(store.enable("alice", conn.id, revoked.revision)),
    ).toMatchObject({
      id: "mcp_connection_revoked_terminal",
      status: 400,
    });

    // Disable blocked
    expect(
      await rejectionOf(store.disable("alice", conn.id, revoked.revision)),
    ).toMatchObject({
      id: "mcp_connection_revoked_terminal",
      status: 400,
    });

    // Label update blocked
    expect(
      await rejectionOf(
        store.updateLabel("alice", conn.id, revoked.revision, "New Label"),
      ),
    ).toMatchObject({
      id: "mcp_connection_revoked_terminal",
      status: 400,
    });

    await store.delete("alice", conn.id, revoked.revision);
  });

  test("8. immutable binding/digest stale operator changes denied zero edits", async () => {
    const fixture = await betaFixture();
    const originalProfile = makeTestProfile({
      resource: "https://mcp.example.com/v1",
      timeoutMs: 5000,
    });
    let activeConfig = makeRealConfig([originalProfile]);
    const store = new McpRegistryStore(fixture.db, () => activeConfig);

    const conn = await store.create("alice", {
      profileId: originalProfile.profileId,
      profileRevision: originalProfile.revision,
      purpose: "mcp.list",
      label: "Digest Guard",
    });
    const disabled = await store.disable("alice", conn.id, conn.revision);

    // Operator mutates profile under the same profileId and revision!
    const alteredProfile = makeTestProfile({
      resource: "https://mcp.example.com/v2-stealth",
      timeoutMs: 9000,
    });
    activeConfig = makeRealConfig([alteredProfile]);

    // Enable attempt detects altered snapshot digest and rejects
    expect(
      await rejectionOf(store.enable("alice", conn.id, disabled.revision)),
    ).toMatchObject({
      id: "mcp_profile_digest_mismatch",
      status: 409,
    });

    // In DB: state is still disabled, revision unchanged
    const stored = await store.get("alice", conn.id);
    expect(stored.state).toBe("disabled");
    expect(stored.revision).toBe(disabled.revision);

    // Restore original config to delete cleanly
    activeConfig = makeRealConfig([originalProfile]);
    await store.delete("alice", conn.id, disabled.revision);
  });

  test("9. expiry/config changes while waiting lock deny", async () => {
    const fixture = await betaFixture();
    let simNow = Date.now();
    const testProfile = makeTestProfile({
      expiresAt: new Date(simNow + 5000).toISOString(),
    });
    let activeConfig = makeRealConfig([testProfile], () => simNow);
    const store = new McpRegistryStore(fixture.db, () => activeConfig);

    // Part A: Direct pre-check of already expired profile
    simNow = Date.now() + 10_000; // Past expiry
    expect(
      await rejectionOf(
        store.create("alice", {
          profileId: testProfile.profileId,
          profileRevision: testProfile.revision,
          purpose: "mcp.list",
          label: "Direct Expired",
        }),
      ),
    ).toMatchObject({
      id: "profile_expired",
      status: 400,
    });

    // Part B: Direct disabled config check
    const storeDisabled = new McpRegistryStore(fixture.db, () => undefined);
    expect(
      await rejectionOf(
        storeDisabled.create("alice", {
          profileId: testProfile.profileId,
          profileRevision: testProfile.revision,
          purpose: "mcp.list",
          label: "Disabled Config",
        }),
      ),
    ).toMatchObject({
      id: "mcp_client_disabled",
      status: 503,
    });

    // Part C: Barrier-controlled transaction holding lockByokResources while profile expires
    simNow = Date.now();
    const freshProfile = makeTestProfile({
      expiresAt: new Date(simNow + 20_000).toISOString(),
    });
    activeConfig = makeRealConfig([freshProfile], () => simNow);

    let releaseBlocker: (() => void) | undefined;
    const blockerPromise = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    let blockerAcquired: (() => void) | undefined;
    const acquiredPromise = new Promise<void>((resolve) => {
      blockerAcquired = resolve;
    });

    // Blocker transaction holds lockByokResources
    const blockerTx = fixture.db.transaction(async (tx) => {
      await lockByokResources(tx);
      blockerAcquired?.();
      await blockerPromise;
    });

    await acquiredPromise;

    // Start store.create in background - it blocks on lockByokResources
    const pendingCreate = store.create("alice", {
      profileId: freshProfile.profileId,
      profileRevision: freshProfile.revision,
      purpose: "mcp.list",
      label: "Pending Expiry",
    });

    // Before releasing lock, advance clock to expire the profile
    simNow = Date.now() + 50_000;

    // Release the blocker transaction
    releaseBlocker?.();
    await blockerTx;

    // create rechecks after lock and rejects
    expect(await rejectionOf(pendingCreate)).toMatchObject({
      id: "profile_expired",
      status: 400,
    });

    // Prove zero DB mutation occurred
    const checkNoInsert = await fixture.db.execute<{ id: string }>(
      sql`SELECT id FROM mcp_connection WHERE label = 'Pending Expiry'`,
    );
    expect(checkNoInsert).toHaveLength(0);

    // Part D: Barrier-controlled re-enable operator mismatch while waiting lock
    simNow = Date.now();
    const reProfile = makeTestProfile({
      resource: "https://mcp.example.com/stable",
    });
    activeConfig = makeRealConfig([reProfile], () => simNow);

    const reConn = await store.create("alice", {
      profileId: reProfile.profileId,
      profileRevision: reProfile.revision,
      purpose: "mcp.list",
      label: "Re-enable Lock Guard",
    });
    const reDisabled = await store.disable("alice", reConn.id, reConn.revision);

    let releaseBlocker2: (() => void) | undefined;
    const blockerPromise2 = new Promise<void>((resolve) => {
      releaseBlocker2 = resolve;
    });

    let blockerAcquired2: (() => void) | undefined;
    const acquiredPromise2 = new Promise<void>((resolve) => {
      blockerAcquired2 = resolve;
    });

    const blockerTx2 = fixture.db.transaction(async (tx) => {
      await lockByokResources(tx);
      blockerAcquired2?.();
      await blockerPromise2;
    });

    await acquiredPromise2;

    const pendingEnable = store.enable("alice", reConn.id, reDisabled.revision);

    // Alter operator profile while enable is waiting for lock
    const alteredReProfile = makeTestProfile({
      resource: "https://mcp.example.com/altered-during-lock",
    });
    activeConfig = makeRealConfig([alteredReProfile], () => simNow);

    releaseBlocker2?.();
    await blockerTx2;

    expect(await rejectionOf(pendingEnable)).toMatchObject({
      id: "mcp_profile_digest_mismatch",
      status: 409,
    });

    // Verify row remains disabled with unchanged revision
    const afterFailedEnable = await store.get("alice", reConn.id);
    expect(afterFailedEnable.state).toBe("disabled");
    expect(afterFailedEnable.revision).toBe(reDisabled.revision);

    // Clean up
    await store.delete("alice", reConn.id, reDisabled.revision);
  });

  test("10. config off still list/export/disable/revoke/delete", async () => {
    const fixture = await betaFixture();
    const profile = makeTestProfile();
    const validConfig = makeRealConfig([profile]);
    const activeStore = new McpRegistryStore(fixture.db, () => validConfig);

    const conn = await activeStore.create("alice", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "Config Off Test",
    });

    // Now config is disabled
    const offStore = new McpRegistryStore(fixture.db, () => undefined);

    // List works
    const list = await offStore.list("alice");
    expect(list.some((c) => c.id === conn.id)).toBe(true);

    // Get works
    const got = await offStore.get("alice", conn.id);
    expect(got.id).toBe(conn.id);

    // Export works
    const exported = await offStore.export("alice");
    expect(exported.some((c) => c.id === conn.id)).toBe(true);

    // Disable works
    const disabled = await offStore.disable("alice", conn.id, conn.revision);
    expect(disabled.state).toBe("disabled");

    // Revoke works
    const revoked = await offStore.revoke("alice", conn.id, disabled.revision);
    expect(revoked.state).toBe("revoked");

    // Delete works
    await offStore.delete("alice", conn.id, revoked.revision);
    expect(await rejectionOf(offStore.get("alice", conn.id))).toMatchObject({
      id: "not_found",
      status: 404,
    });
  });

  test("11. account delete cascade and all pre-existing financial holds remain protected", async () => {
    const fixture = await betaFixture();
    const profile = makeTestProfile();
    const config = makeRealConfig([profile]);
    const store = new McpRegistryStore(fixture.db, () => config);

    // Create user deleter and survivor
    await fixture.db.$client
      .unsafe(
        `INSERT INTO "user"(id,name,email,email_verified,github_login) VALUES
         ('deleter','Deleter','deleter@example.invalid',true,'deleter'),
         ('survivor','Survivor','survivor@example.invalid',true,'survivor')`,
      )
      .simple();

    // Deleter creates an MCP connection
    const deleterConn = await store.create("deleter", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "Deleter Conn",
    });

    // Survivor creates an MCP connection
    const survivorConn = await store.create("survivor", {
      profileId: profile.profileId,
      profileRevision: profile.revision,
      purpose: "mcp.list",
      label: "Survivor Conn",
    });

    // Insert an anonymous BYOK operation hold for deleter using real resourceActor
    const deleterActorKey = resourceActor("deleter", process.env);
    await fixture.db.$client
      .unsafe(
        `INSERT INTO byok_operation(id, actor_key, provider, credential_revision, kind, digest, state, price_revision, reserved_microdollars, actual_microdollars, receipt_credits)
         VALUES ('op-deleter-hold', '${deleterActorKey}', 'tavily', 'rev-1', 'search', 'digest-d', 'held', 'price-1', 5000, 5000, 1)`,
      )
      .simple();

    // Export deleter before deletion
    const exportBefore = await exportOwnedAccount("deleter");
    expect(exportBefore.mcpConnections).toHaveLength(1);
    expect(exportBefore.mcpConnections[0].id).toBe(deleterConn.id);

    // Delete deleter account
    await deleteOwnedAccount("deleter");

    // Deleter MCP connections are cascaded and removed
    const deleterConns = await fixture.db.execute<{ id: string }>(
      sql`SELECT id FROM mcp_connection WHERE user_id = 'deleter'`,
    );
    expect(deleterConns).toHaveLength(0);

    // Survivor connection is completely intact
    const survivorCheck = await store.get("survivor", survivorConn.id);
    expect(survivorCheck.id).toBe(survivorConn.id);

    // Anonymous financial hold survives account deletion with exact liability amounts
    const [holdRow] = await fixture.db.execute<{
      id: string;
      state: string;
      reserved_microdollars: number;
      actual_microdollars: number;
    }>(
      sql`SELECT id, state, reserved_microdollars, actual_microdollars FROM byok_operation WHERE id = 'op-deleter-hold'`,
    );
    expect(holdRow).toBeDefined();
    expect(holdRow.state).toBe("held");
    expect(holdRow.reserved_microdollars).toBe(5000);
    expect(holdRow.actual_microdollars).toBe(5000);

    // Clean up survivor
    await deleteOwnedAccount("survivor");
  });
});
