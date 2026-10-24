import { mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { EnvSource } from "@/lib/auth/env";
import type { DatabaseTransaction } from "@/lib/db/client";
import type { OAuthManifest, OAuthRuntime } from "@/lib/mcp/oauth-contract";
import { betaFixture } from "./beta-fixture";

mock.module("server-only", () => ({}));
const { createFixtureMcpOAuthStore } = await import("@/lib/mcp/oauth-store");
const { OAUTH_PURPOSES } = await import("@/lib/mcp/oauth-contract");
const { parseProfileEntry } = await import("@/lib/mcp/config");
const { computeProfileDigest } = await import("@/lib/mcp/registry-contract");
const { operationDigest } = await import("@/lib/mcp/operation-contract");
export async function mcpOAuthFixture() {
  const profiles = OAUTH_PURPOSES.map((purpose) =>
    parseProfileEntry({
      profileId: purpose.replaceAll(".", "_"),
      revision: "synthetic-v1",
      purpose,
      resource: "https://resource.example.com/mcp",
      issuer: "https://issuer.example.com/",
      credential:
        purpose === "oauth.refresh"
          ? "refresh"
          : purpose === "oauth.revoke"
            ? "revoke"
            : "none",
      maxRequestBytes: 1024,
      maxResponseBytes: 4096,
      timeoutMs: 20000,
      expiresAt: "2030-01-01T00:00:00.000Z",
    }),
  );
  const fixture = await betaFixture({
    skipPlanRegistration: true,
    environment: {
      MCP_CLIENT_ENABLED: "1",
      MCP_CLIENT_PROFILES_JSON: JSON.stringify(profiles),
    },
  });
  let environment: EnvSource = { ...process.env };
  const manifests: OAuthManifest[] = profiles.map((p) => ({
    id: p.profileId,
    revision: "synthetic-v1",
    purpose: p.purpose as OAuthManifest["purpose"],
    profile: {
      id: p.profileId,
      revision: p.revision,
      digest: computeProfileDigest(p),
    },
    issuer: p.issuer,
    resource: p.resource,
    endpoint: `https://issuer.example.com/${p.profileId}`,
    authorizationEndpoint: "https://issuer.example.com/authorize",
    brokerEndpoint: "https://broker.example.com/v1/egress",
    clientId: "synthetic-client-not-registered",
    redirectUri: "https://galaxy.example.com/mcp/callback",
    scopes: ["fixture:read"],
    formFields: {
      client_id: "synthetic-client-not-registered",
      ...(p.purpose === "oauth.token"
        ? { redirect_uri: "https://galaxy.example.com/mcp/callback" }
        : {}),
      scope: "fixture:read",
    },
    expiresAt: p.expiresAt,
    provenance: "synthetic-offline-untrusted",
  }));
  let runtime: OAuthRuntime = {
    activeKeyVersion: "v1",
    keys: { v1: Buffer.alloc(32, 42).toString("base64") },
    counterSecret: "offline-oauth-counter-secret-at-least-32-characters",
    manifests,
  };
  // Better Auth's trusted GitHub account identity is independent of mutable login/user id.
  const githubAccounts = { alice: "10001", bob: "10002" };
  for (const [owner, accountId] of Object.entries(githubAccounts))
    await fixture.db.$client.unsafe(
      "INSERT INTO account(id,account_id,provider_id,user_id) VALUES ($1,$2,'github',$3)",
      [`oauth-github-${owner}`, accountId, owner],
    );
  const connections = new Map<string, { id: string; revision: string }>();
  for (const user of ["alice", "bob"]) {
    const connection = {
      id: crypto.randomUUID(),
      revision: crypto.randomUUID(),
    };
    connections.set(user, connection);
    await fixture.db.$client.unsafe(
      "INSERT INTO mcp_connection(id,user_id,profile_id,profile_revision,purpose,profile_digest,label,state,revision) VALUES ($1,$2,'anchor','v1','mcp.call',$3,'Synthetic offline','configured',$4)",
      [connection.id, user, "a".repeat(64), connection.revision],
    );
  }
  let clock: Date | undefined;
  let hook:
    | ((
        statement: string,
        result: unknown,
        tx: DatabaseTransaction,
      ) => void | Promise<void>)
    | undefined;
  const dialect = new PgDialect();
  const observed = new Proxy(fixture.db, {
    get(target, key, receiver) {
      if (key === "transaction")
        return <T>(
          run: (tx: DatabaseTransaction) => Promise<T>,
          options?: Parameters<typeof fixture.db.transaction>[1],
        ) =>
          target.transaction(
            (tx) =>
              run(
                new Proxy(tx, {
                  get(t, property, r) {
                    if (property === "execute")
                      return async <R extends Record<string, unknown>>(
                        query: Parameters<DatabaseTransaction["execute"]>[0],
                      ) => {
                        const result = await t.execute<R>(query);
                        if (clock)
                          for (const row of result)
                            if ("now" in row)
                              Reflect.set(row, "now", new Date(clock));
                        await hook?.(
                          typeof query === "string"
                            ? query
                            : dialect.sqlToQuery(query.getSQL()).sql,
                          result,
                          t,
                        );
                        return result;
                      };
                    return Reflect.get(t, property, r);
                  },
                }),
              ),
            options,
          );
      return Reflect.get(target, key, receiver);
    },
  });
  const store = createFixtureMcpOAuthStore({
    db: observed,
    runtime: () => runtime,
    env: () => environment,
  });
  async function bind(
    purpose: OAuthManifest["purpose"] = "oauth.token",
    owner = "alice",
  ) {
    const m = runtime.manifests.find((m) => m.purpose === purpose);
    if (!m) throw new Error("fixture_manifest_missing");
    const connection = connections.get(owner);
    if (!connection) throw new Error("fixture_owner_missing");
    return store.issueBinding(owner, {
      id: crypto.randomUUID(),
      connectionId: connection.id,
      connectionRevision: connection.revision,
      manifestId: m.id,
      manifestDigest: operationDigest(m),
    });
  }
  async function state(bindingId: string, owner = "alice") {
    return store.beginState(owner, {
      bindingId,
      expectedBindingRevision: 1,
      session: `${owner}-session`,
      redirectUri: manifests[0].redirectUri,
    });
  }
  async function grant(owner = "alice") {
    const binding = await bind("oauth.token", owner),
      pending = await state(binding.id, owner),
      consumed = await store.consumeState(owner, {
        state: pending.state,
        session: `${owner}-session`,
        redirectUri: manifests[0].redirectUri,
      });
    const input = {
      id: crypto.randomUUID(),
      bindingId: binding.id,
      stateId: consumed.id,
      expectedStateRevision: consumed.revision,
      session: `${owner}-session`,
      accessToken: "synthetic-access-never-sent",
      refreshToken: "synthetic-refresh-never-sent",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    return {
      binding,
      pending,
      consumed,
      input,
      grant: await store.installFixtureGrant(owner, input),
    };
  }
  return {
    ...fixture,
    db: observed,
    store,
    profiles,
    manifests,
    connections,
    githubAccounts,
    bind,
    state,
    grant,
    get env() {
      return environment;
    },
    setEnv(value: EnvSource) {
      environment = value;
    },
    get runtime() {
      return runtime;
    },
    setRuntime(value: OAuthRuntime) {
      runtime = value;
    },
    setClock(value: Date | undefined) {
      clock = value;
    },
    afterQuery(value: typeof hook) {
      hook = value;
    },
  };
}
