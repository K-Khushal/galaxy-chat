import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  type EnvSource,
  isInvitedLogin,
  parseInviteLogins,
} from "@/lib/auth/env";
import { lockByokResources } from "@/lib/byok/store";
import {
  type Database,
  type DatabaseTransaction,
  requireDb,
} from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { canonicalJson } from "@/lib/funding/config";
import { parseProfilesJson, profileKey } from "./config";
import {
  bindingInputSchema,
  callbackSchema,
  grantInputSchema,
  OAUTH_LIMITS,
  type OAuthGrantView,
  type OAuthManifest,
  type OAuthRuntime,
  oauthFixtureGate,
  oauthRuntimeSchema,
  oauthUnavailable,
  parseOAuth,
  type SealedOAuthSecret,
} from "./oauth-contract";
import {
  newPkce,
  type OAuthSecretBinding,
  oauthHash,
  openOAuthSecret,
  sealOAuthSecret,
} from "./oauth-crypto";
import { operationDigest } from "./operation-contract";
import { computeProfileDigest } from "./registry-contract";

type Tx = DatabaseTransaction;
type Binding = {
  id: string;
  user_id: string;
  connection_id: string;
  connection_revision: string;
  connection_profile_digest: string;
  purpose: OAuthManifest["purpose"];
  profile_id: string;
  profile_revision: string;
  profile_digest: string;
  manifest_digest: string;
  manifest: OAuthManifest;
  revision: number;
  state: string;
};
type Grant = {
  id: string;
  user_id: string;
  connection_id: string;
  binding_id: string;
  state_id: string;
  revision: number;
  refresh_fence: number;
  state: OAuthGrantView["state"];
  access_secret: SealedOAuthSecret | null;
  refresh_secret: SealedOAuthSecret | null;
  expires_at: Date;
};
type Pkce = {
  id: string;
  binding_id: string;
  session_hash: string;
  redirect_uri: string;
  verifier: SealedOAuthSecret | null;
  challenge: string;
  state: string;
  revision: number;
  expires_at: Date;
};
type Claim = {
  id: string;
  user_id: string;
  grant_id: string;
  binding_id: string;
  credential_revision: number;
  fence: number;
  state: string;
  revision: number;
  deadline: Date;
};
type Options = { db: Database; runtime: () => unknown; env: () => EnvSource };
const uuid = z.uuid();
const revision = z.number().int().positive();
const beginSchema = z
  .object({
    bindingId: uuid,
    expectedBindingRevision: revision,
    session: z.string().min(1).max(256),
    redirectUri: z.string().max(2048),
  })
  .strict();
const refreshInputSchema = z
  .object({
    id: uuid,
    grantId: uuid,
    expectedRevision: revision,
    bindingId: uuid,
  })
  .strict();
const replacementSchema = z
  .object({
    accessToken: z.string().min(1).max(8192),
    refreshToken: z.string().min(1).max(8192),
    expiresAt: z.iso.datetime(),
  })
  .strict();
function same(a: unknown, b: unknown) {
  if (canonicalJson(a) !== canonicalJson(b))
    throw new AppError("mcp_oauth_binding_changed", 409);
}
function cas(actual: number, expected: number) {
  if (!Number.isSafeInteger(expected) || actual !== expected)
    throw new AppError("mcp_oauth_conflict", 409);
}
function grantView(row: Grant): OAuthGrantView {
  return Object.freeze({
    id: row.id,
    bindingId: row.binding_id,
    revision: row.revision,
    state: row.state,
    expiresAt: new Date(row.expires_at).toISOString(),
    hasRefreshToken: Boolean(row.refresh_secret),
  });
}
function claimView(row: Claim) {
  return Object.freeze({
    id: row.id,
    grantId: row.grant_id,
    revision: row.revision,
    fence: row.fence,
    state: row.state,
    deadline: new Date(row.deadline).toISOString(),
  });
}

function storageError(error: unknown): AppError {
  // Driver details may contain rejected encrypted row material or SQL text.
  const cause =
    error && typeof error === "object" && "cause" in error
      ? error.cause
      : error;
  if (
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    (cause.code === "23505" || cause.code === "23514" || cause.code === "P0001")
  )
    return new AppError("mcp_oauth_storage_conflict", 409);
  return new AppError("mcp_oauth_storage_unavailable", 503);
}

class OAuthStore {
  constructor(
    private readonly options: Options,
    private readonly fixture: boolean,
  ) {}
  private gate() {
    if (!this.fixture) oauthUnavailable();
    oauthFixtureGate();
  }
  private runtime(): Readonly<OAuthRuntime> {
    this.gate();
    return parseOAuth(oauthRuntimeSchema, this.options.runtime());
  }
  private transaction<T>(run: (tx: Tx) => Promise<T>) {
    return this.options.db
      .transaction(
        async (tx) => {
          await lockByokResources(tx);
          return run(tx);
        },
        { isolationLevel: "read committed" },
      )
      .catch((error: unknown) => {
        if (error instanceof AppError) throw error;
        throw storageError(error);
      });
  }
  private async now(tx: Tx) {
    const [r] = await tx.execute<{ now: Date }>(
      sql`SELECT clock_timestamp() AS now`,
    );
    return new Date(r.now);
  }
  private async binding(tx: Tx, owner: string, id: string) {
    const [r] = await tx.execute<Binding>(
      sql`SELECT * FROM mcp_oauth_binding WHERE id=${id} AND user_id=${owner}`,
    );
    if (!r) throw new AppError("not_found", 404);
    return r;
  }
  private async grant(tx: Tx, owner: string, id: string) {
    const [r] = await tx.execute<Grant>(
      sql`SELECT * FROM mcp_oauth_grant WHERE id=${id} AND user_id=${owner}`,
    );
    if (!r) throw new AppError("not_found", 404);
    return r;
  }
  private secretBinding(
    binding: Binding,
    id: string,
    credentialRevision: number,
    kind: OAuthSecretBinding["kind"],
    sessionHash?: string,
  ): OAuthSecretBinding {
    return {
      ownerId: binding.user_id,
      connectionId: binding.connection_id,
      connectionRevision: binding.connection_revision,
      grantId: id,
      profileDigest: binding.profile_digest,
      manifestDigest: binding.manifest_digest,
      credentialRevision,
      kind,
      sessionHash,
    };
  }
  /** Final DB observation and synchronous authoritative runtime/profile checks after all other awaits. */
  private async final(
    tx: Tx,
    owner: string,
    binding: Binding,
    expected: Readonly<OAuthRuntime>,
    session?: string,
    extraBinding?: Binding,
  ) {
    this.gate();
    const [row] = await tx.execute<{
      now: Date;
      github_login: string | null;
      connection_state: string;
      connection_revision: string;
      connection_profile_digest: string;
      binding_revision: number;
      binding_state: string;
      session_valid: boolean;
      bindings_valid: boolean;
    }>(
      sql`SELECT clock_timestamp() AS now,u.github_login,c.state AS connection_state,c.revision AS connection_revision,c.profile_digest AS connection_profile_digest,b.revision AS binding_revision,b.state AS binding_state,${session === undefined ? sql`true` : sql`EXISTS(SELECT 1 FROM session s WHERE s.user_id=u.id AND s.id=${session} AND s.expires_at>clock_timestamp())`} AS session_valid,${extraBinding === undefined ? sql`true` : sql`EXISTS(SELECT 1 FROM mcp_oauth_binding b2 JOIN mcp_connection c2 ON c2.id=b2.connection_id AND c2.user_id=b2.user_id WHERE b2.id=${extraBinding.id} AND b2.user_id=${owner} AND b2.state='configured' AND b2.revision=${extraBinding.revision} AND c2.state='configured' AND c2.revision=${extraBinding.connection_revision} AND c2.profile_digest=${extraBinding.connection_profile_digest})`} AS bindings_valid FROM "user" u JOIN mcp_connection c ON c.user_id=u.id AND c.id=${binding.connection_id} JOIN mcp_oauth_binding b ON b.user_id=u.id AND b.connection_id=c.id AND b.id=${binding.id} WHERE u.id=${owner}`,
    );
    this.gate();
    if (!row) throw new AppError("not_found", 404);
    const runtime = this.runtime(),
      env = this.options.env(),
      now = new Date(row.now);
    same(runtime, expected);
    if (
      !isInvitedLogin(
        row.github_login,
        parseInviteLogins(env.GITHUB_INVITE_LOGINS),
      )
    )
      throw new AppError("mcp_oauth_invite_required", 403);
    if (!row.bindings_valid)
      throw new AppError("mcp_oauth_binding_changed", 409);
    if (!row.session_valid)
      throw new AppError("mcp_oauth_session_changed", 403);
    if (
      row.connection_state !== "configured" ||
      row.connection_revision !== binding.connection_revision ||
      row.connection_profile_digest !== binding.connection_profile_digest ||
      row.binding_state !== "configured" ||
      row.binding_revision !== binding.revision
    )
      throw new AppError("mcp_oauth_binding_changed", 409);
    for (const current of extraBinding ? [binding, extraBinding] : [binding]) {
      const manifest = runtime.manifests.find(
        (m) => m.id === current.manifest.id,
      );
      if (
        !manifest ||
        operationDigest(manifest) !== current.manifest_digest ||
        new Date(manifest.expiresAt) <= now
      )
        throw new AppError("mcp_oauth_manifest_changed", 409);
      same(manifest, current.manifest);
      const profile = parseProfilesJson(env.MCP_CLIENT_PROFILES_JSON).get(
        profileKey(
          current.profile_id,
          current.profile_revision,
          current.purpose,
        ),
      );
      if (
        env.MCP_CLIENT_ENABLED !== "1" ||
        !profile ||
        computeProfileDigest(profile) !== current.profile_digest ||
        new Date(profile.expiresAt) <= now ||
        profile.issuer !== manifest.issuer ||
        profile.resource !== manifest.resource
      )
        throw new AppError("mcp_oauth_profile_changed", 409);
      const credential =
        current.purpose === "oauth.refresh"
          ? "refresh"
          : current.purpose === "oauth.revoke"
            ? "revoke"
            : "none";
      if (profile.credential !== credential)
        throw new AppError("mcp_oauth_profile_changed", 409);
    }
    return now;
  }
  private async record(
    tx: Tx,
    owner: string,
    kind: string,
    runtime: Readonly<OAuthRuntime>,
    recordId: string = randomUUID(),
  ) {
    // Better Auth persists the provider's verified numeric account id. Local user ids
    // and GitHub login labels can change after deletion or rename, so neither is a principal.
    // Lock both owned rows: account updates/deletion and a new FK-linked binding must
    // wait until this admission commits. More than one GitHub binding is ambiguous.
    const [owned] = await tx.execute<{ id: string }>(
      sql`SELECT id FROM "user" WHERE id=${owner} FOR UPDATE`,
    );
    if (!owned) throw new AppError("mcp_oauth_principal_unavailable", 503);
    // This separate READ COMMITTED read is fresh after the owner-lock wait.
    const accounts = await tx.execute<{ account_id: string }>(
      sql`SELECT account_id FROM account WHERE user_id=${owner} AND provider_id='github' ORDER BY id LIMIT 2 FOR UPDATE`,
    );
    if (
      accounts.length !== 1 ||
      !/^[1-9][0-9]{0,19}$/.test(accounts[0].account_id)
    )
      throw new AppError("mcp_oauth_principal_unavailable", 503);
    const fingerprint = createHmac("sha256", runtime.counterSecret)
      .update("galaxy-mcp-oauth-counter-v1")
      .digest("hex");
    const [registered] = await tx.execute<{ fingerprint: string }>(
      sql`SELECT fingerprint FROM mcp_oauth_counter_key WHERE id='counter'`,
    );
    if (registered && registered.fingerprint !== fingerprint)
      throw new AppError("mcp_oauth_counter_rotation_unknown", 503);
    await tx.execute(
      sql`INSERT INTO mcp_oauth_counter_key(id,fingerprint) VALUES ('counter',${fingerprint}) ON CONFLICT DO NOTHING`,
    );
    const actor = createHmac("sha256", runtime.counterSecret)
        .update(
          JSON.stringify([
            "galaxy-mcp-oauth-github-principal-v1",
            "github",
            accounts[0].account_id,
          ]),
        )
        .digest("hex"),
      now = await this.now(tx),
      day = now.toISOString().slice(0, 10);
    const [count] = await tx.execute<{
      owner_records: number;
      global_records: number;
      owner_day: number;
      global_day: number;
    }>(
      sql`SELECT count(*) FILTER(WHERE actor_key=${actor})::integer AS owner_records,count(*)::integer AS global_records,count(*) FILTER(WHERE actor_key=${actor} AND day=${day})::integer AS owner_day,count(*) FILTER(WHERE day=${day})::integer AS global_day FROM mcp_oauth_record WHERE kind<>'unknown'`,
    );
    if (
      count.owner_records >= OAUTH_LIMITS.ownerRecords ||
      count.global_records >= OAUTH_LIMITS.globalRecords ||
      count.owner_day >= OAUTH_LIMITS.ownerDaily ||
      count.global_day >= OAUTH_LIMITS.globalDaily
    )
      throw new AppError("mcp_oauth_record_limit", 429);
    await tx.execute(
      sql`INSERT INTO mcp_oauth_record(id,actor_key,kind,day) VALUES (${recordId},${actor},${kind},${day})`,
    );
    return day;
  }
  async issueBinding(owner: string, raw: unknown) {
    this.gate();
    const input = parseOAuth(bindingInputSchema, raw),
      runtime = this.runtime();
    const manifest = runtime.manifests.find((m) => m.id === input.manifestId);
    if (!manifest || operationDigest(manifest) !== input.manifestDigest)
      throw new AppError("mcp_oauth_manifest_changed", 409);
    return this.transaction(async (tx) => {
      const [connection] = await tx.execute<{
        revision: string;
        profile_digest: string;
        state: string;
      }>(
        sql`SELECT revision,profile_digest,state FROM mcp_connection WHERE id=${input.connectionId} AND user_id=${owner}`,
      );
      if (!connection) throw new AppError("not_found", 404);
      if (
        connection.revision !== input.connectionRevision ||
        connection.state !== "configured"
      )
        throw new AppError("mcp_oauth_binding_changed", 409);
      const admissionDay = await this.record(tx, owner, "binding", runtime);
      const [binding] = await tx.execute<Binding>(
        sql`INSERT INTO mcp_oauth_binding(id,user_id,connection_id,connection_revision,connection_profile_digest,purpose,profile_id,profile_revision,profile_digest,manifest_digest,manifest) VALUES (${input.id},${owner},${input.connectionId},${input.connectionRevision},${connection.profile_digest},${manifest.purpose},${manifest.profile.id},${manifest.profile.revision},${manifest.profile.digest},${input.manifestDigest},${JSON.stringify(manifest)}::jsonb) RETURNING *`,
      );
      const final = await this.final(tx, owner, binding, runtime);
      if (final.toISOString().slice(0, 10) !== admissionDay)
        throw new AppError("mcp_oauth_clock_changed", 409);
      return {
        id: binding.id,
        revision: binding.revision,
        purpose: binding.purpose,
      };
    });
  }
  async beginState(owner: string, raw: unknown) {
    this.gate();
    const input = parseOAuth(beginSchema, raw),
      runtime = this.runtime(),
      pkce = newPkce(),
      id = randomUUID();
    return this.transaction(async (tx) => {
      const binding = await this.binding(tx, owner, input.bindingId);
      cas(binding.revision, input.expectedBindingRevision);
      if (
        binding.purpose !== "oauth.token" ||
        input.redirectUri !== binding.manifest.redirectUri
      )
        throw new AppError("mcp_oauth_purpose_denied", 403);
      const now = await this.final(tx, owner, binding, runtime, input.session),
        expires = new Date(
          Math.min(
            now.getTime() + OAUTH_LIMITS.stateMs,
            new Date(binding.manifest.expiresAt).getTime(),
          ),
        );
      const verifier = sealOAuthSecret(
        pkce.verifier,
        this.secretBinding(binding, id, 1, "pkce", oauthHash(input.session)),
        runtime,
      );
      const admissionDay = await this.record(tx, owner, "state", runtime);
      await tx.execute(
        sql`INSERT INTO mcp_oauth_state(id,user_id,binding_id,connection_id,state_hash,session_hash,redirect_uri,verifier,challenge,expires_at) VALUES (${id},${owner},${binding.id},${binding.connection_id},${oauthHash(pkce.state)},${oauthHash(input.session)},${input.redirectUri},${JSON.stringify(verifier)}::jsonb,${pkce.challenge},${expires.toISOString()})`,
      );
      const final = await this.final(
        tx,
        owner,
        binding,
        runtime,
        input.session,
      );
      if (final >= expires || final.toISOString().slice(0, 10) !== admissionDay)
        throw new AppError("mcp_oauth_expired", 409);
      return Object.freeze({
        id,
        revision: 1,
        state: pkce.state,
        challenge: pkce.challenge,
        challengeMethod: "S256" as const,
        expiresAt: expires.toISOString(),
      });
    });
  }
  async consumeState(owner: string, raw: unknown) {
    this.gate();
    const input = parseOAuth(callbackSchema, raw),
      runtime = this.runtime();
    return this.transaction(async (tx) => {
      const [state] = await tx.execute<Pkce>(
        sql`SELECT * FROM mcp_oauth_state WHERE user_id=${owner} AND state_hash=${oauthHash(input.state)}`,
      );
      if (!state) throw new AppError("not_found", 404);
      const binding = await this.binding(tx, owner, state.binding_id);
      if (
        state.state !== "pending" ||
        !state.verifier ||
        state.session_hash !== oauthHash(input.session) ||
        state.redirect_uri !== input.redirectUri ||
        binding.manifest.redirectUri !== input.redirectUri
      )
        throw new AppError("mcp_oauth_state_denied", 403);
      const now = await this.final(tx, owner, binding, runtime, input.session);
      if (new Date(state.expires_at) <= now)
        throw new AppError("mcp_oauth_expired", 409);
      const verifier = openOAuthSecret(
        state.verifier,
        this.secretBinding(binding, state.id, 1, "pkce", state.session_hash),
        runtime,
      );
      await tx.execute(
        sql`UPDATE mcp_oauth_state SET state='consumed',verifier=NULL,revision=revision+1 WHERE id=${state.id} AND revision=${state.revision}`,
      );
      const final = await this.final(
        tx,
        owner,
        binding,
        runtime,
        input.session,
      );
      if (new Date(state.expires_at) <= final)
        throw new AppError("mcp_oauth_expired", 409);
      return Object.freeze({
        id: state.id,
        bindingId: binding.id,
        revision: state.revision + 1,
        verifier,
      });
    });
  }
  async installFixtureGrant(owner: string, raw: unknown) {
    this.gate();
    const input = parseOAuth(grantInputSchema, raw),
      runtime = this.runtime();
    return this.transaction(async (tx) => {
      const binding = await this.binding(tx, owner, input.bindingId);
      const [state] = await tx.execute<Pkce>(
        sql`SELECT * FROM mcp_oauth_state WHERE id=${input.stateId} AND user_id=${owner} AND binding_id=${binding.id}`,
      );
      if (!state) throw new AppError("not_found", 404);
      cas(state.revision, input.expectedStateRevision);
      if (
        binding.purpose !== "oauth.token" ||
        state.state !== "consumed" ||
        state.session_hash !== oauthHash(input.session)
      )
        throw new AppError("mcp_oauth_state_denied", 403);
      const now = await this.final(tx, owner, binding, runtime, input.session);
      if (
        new Date(state.expires_at) <= now ||
        new Date(input.expiresAt) <= now ||
        new Date(input.expiresAt) > new Date(binding.manifest.expiresAt)
      )
        throw new AppError("mcp_oauth_expired", 409);
      const access = sealOAuthSecret(
          input.accessToken,
          this.secretBinding(binding, input.id, 1, "access"),
          runtime,
        ),
        refresh =
          input.refreshToken === null
            ? null
            : sealOAuthSecret(
                input.refreshToken,
                this.secretBinding(binding, input.id, 1, "refresh"),
                runtime,
              );
      const admissionDay = await this.record(tx, owner, "grant", runtime);
      const [grant] = await tx.execute<Grant>(
        sql`INSERT INTO mcp_oauth_grant(id,user_id,connection_id,binding_id,state_id,access_secret,refresh_secret,expires_at) VALUES (${input.id},${owner},${binding.connection_id},${binding.id},${state.id},${JSON.stringify(access)}::jsonb,${refresh === null ? null : JSON.stringify(refresh)}::jsonb,${input.expiresAt}) RETURNING *`,
      );
      await tx.execute(
        sql`UPDATE mcp_oauth_state SET state='issued',revision=revision+1 WHERE id=${state.id} AND revision=${state.revision}`,
      );
      const final = await this.final(
        tx,
        owner,
        binding,
        runtime,
        input.session,
      );
      if (
        new Date(state.expires_at) <= final ||
        new Date(input.expiresAt) <= final ||
        final.toISOString().slice(0, 10) !== admissionDay
      )
        throw new AppError("mcp_oauth_expired", 409);
      return grantView(grant);
    });
  }
  async openAccess(owner: string, id: string, expectedRevision: number) {
    this.gate();
    const runtime = this.runtime();
    return this.transaction(async (tx) => {
      const grant = await this.grant(tx, owner, id);
      cas(grant.revision, expectedRevision);
      const binding = await this.binding(tx, owner, grant.binding_id);
      if (grant.state !== "active" || !grant.access_secret)
        throw new AppError("mcp_oauth_secret_denied", 403);
      const secret = openOAuthSecret(
        grant.access_secret,
        this.secretBinding(binding, id, grant.revision, "access"),
        runtime,
      );
      const now = await this.final(tx, owner, binding, runtime);
      if (new Date(grant.expires_at) <= now)
        throw new AppError("mcp_oauth_expired", 409);
      return secret;
    });
  }
  private async resealGrant(
    tx: Tx,
    grant: Grant,
    binding: Binding,
    runtime: Readonly<OAuthRuntime>,
    access: string,
    refresh: string | null,
    expiresAt: string,
    fence = grant.refresh_fence,
  ) {
    const next = grant.revision + 1,
      sealedAccess = sealOAuthSecret(
        access,
        this.secretBinding(binding, grant.id, next, "access"),
        runtime,
      ),
      sealedRefresh =
        refresh === null
          ? null
          : sealOAuthSecret(
              refresh,
              this.secretBinding(binding, grant.id, next, "refresh"),
              runtime,
            );
    const [updated] = await tx.execute<Grant>(
      sql`UPDATE mcp_oauth_grant SET access_secret=${JSON.stringify(sealedAccess)}::jsonb,refresh_secret=${sealedRefresh === null ? null : JSON.stringify(sealedRefresh)}::jsonb,expires_at=${expiresAt},refresh_fence=${fence},revision=revision+1 WHERE id=${grant.id} AND revision=${grant.revision} AND state='active' RETURNING *`,
    );
    if (!updated) throw new AppError("mcp_oauth_conflict", 409);
    return updated;
  }
  async rotate(owner: string, id: string, expectedRevision: number) {
    this.gate();
    const runtime = this.runtime();
    return this.transaction(async (tx) => {
      const grant = await this.grant(tx, owner, id);
      cas(grant.revision, expectedRevision);
      const binding = await this.binding(tx, owner, grant.binding_id);
      if (grant.state !== "active" || !grant.access_secret)
        throw new AppError("mcp_oauth_secret_denied", 403);
      const [busy] = await tx.execute(
        sql`SELECT id FROM mcp_oauth_refresh WHERE grant_id=${id} AND state IN ('reserved','entered','unknown')`,
      );
      if (busy) throw new AppError("mcp_oauth_refresh_busy", 409);
      const access = openOAuthSecret(
          grant.access_secret,
          this.secretBinding(binding, id, grant.revision, "access"),
          runtime,
        ),
        refresh =
          grant.refresh_secret &&
          openOAuthSecret(
            grant.refresh_secret,
            this.secretBinding(binding, id, grant.revision, "refresh"),
            runtime,
          );
      const updated = await this.resealGrant(
        tx,
        grant,
        binding,
        runtime,
        access,
        refresh,
        new Date(grant.expires_at).toISOString(),
      );
      const now = await this.final(tx, owner, binding, runtime);
      if (new Date(grant.expires_at) <= now)
        throw new AppError("mcp_oauth_expired", 409);
      return grantView(updated);
    });
  }
  async reserveRefresh(owner: string, raw: unknown) {
    this.gate();
    const input = parseOAuth(refreshInputSchema, raw),
      runtime = this.runtime();
    return this.transaction(async (tx) => {
      const grant = await this.grant(tx, owner, input.grantId);
      cas(grant.revision, input.expectedRevision);
      const tokenBinding = await this.binding(tx, owner, grant.binding_id),
        binding = await this.binding(tx, owner, input.bindingId);
      if (
        grant.state !== "active" ||
        !grant.refresh_secret ||
        binding.purpose !== "oauth.refresh" ||
        binding.connection_id !== grant.connection_id ||
        binding.manifest.issuer !== tokenBinding.manifest.issuer ||
        binding.manifest.resource !== tokenBinding.manifest.resource ||
        binding.manifest.clientId !== tokenBinding.manifest.clientId ||
        canonicalJson(binding.manifest.scopes) !==
          canonicalJson(tokenBinding.manifest.scopes)
      )
        throw new AppError("mcp_oauth_purpose_denied", 403);
      await this.final(tx, owner, tokenBinding, runtime);
      const now = await this.final(
          tx,
          owner,
          binding,
          runtime,
          undefined,
          tokenBinding,
        ),
        deadline = new Date(now.getTime() + OAUTH_LIMITS.refreshMs);
      if (new Date(grant.expires_at) <= now)
        throw new AppError("mcp_oauth_expired", 409);
      const [busy] = await tx.execute(
        sql`SELECT id FROM mcp_oauth_refresh WHERE grant_id=${grant.id} AND state IN ('reserved','entered','unknown')`,
      );
      if (busy) throw new AppError("mcp_oauth_refresh_busy", 409);
      const admissionDay = await this.record(
        tx,
        owner,
        "refresh",
        runtime,
        input.id,
      );
      // Reservation reseals the same credentials at a new revision bound to this fence.
      const [claim] = await tx.execute<Claim>(
        sql`INSERT INTO mcp_oauth_refresh(id,user_id,grant_id,binding_id,credential_revision,fence,deadline) VALUES (${input.id},${owner},${grant.id},${binding.id},${grant.revision + 1},${grant.refresh_fence + 1},${deadline.toISOString()}) RETURNING *`,
      );
      const access = openOAuthSecret(
          grant.access_secret as SealedOAuthSecret,
          this.secretBinding(tokenBinding, grant.id, grant.revision, "access"),
          runtime,
        ),
        refresh = openOAuthSecret(
          grant.refresh_secret,
          this.secretBinding(tokenBinding, grant.id, grant.revision, "refresh"),
          runtime,
        );
      const updated = await this.resealGrant(
        tx,
        grant,
        tokenBinding,
        runtime,
        access,
        refresh,
        new Date(grant.expires_at).toISOString(),
        claim.fence,
      );
      // Bind claim to the revision produced by the fenced reservation: immutable claim uses that exact expected revision.
      if (updated.revision !== claim.credential_revision)
        throw new AppError("mcp_oauth_conflict", 409);
      await this.final(tx, owner, tokenBinding, runtime);
      const final = await this.final(
        tx,
        owner,
        binding,
        runtime,
        undefined,
        tokenBinding,
      );
      if (
        final >= deadline ||
        new Date(grant.expires_at) <= final ||
        final.toISOString().slice(0, 10) !== admissionDay
      )
        throw new AppError("mcp_oauth_expired", 409);
      return { ...claimView(claim), credentialRevision: updated.revision };
    });
  }
  private async claim(
    tx: Tx,
    owner: string,
    id: string,
    expectedRevision: number,
  ) {
    const [claim] = await tx.execute<Claim>(
      sql`SELECT * FROM mcp_oauth_refresh WHERE id=${id} AND user_id=${owner}`,
    );
    if (!claim) throw new AppError("not_found", 404);
    cas(claim.revision, expectedRevision);
    return claim;
  }
  private async refreshContext(
    tx: Tx,
    owner: string,
    claim: Claim,
    runtime: Readonly<OAuthRuntime>,
  ) {
    const grant = await this.grant(tx, owner, claim.grant_id),
      tokenBinding = await this.binding(tx, owner, grant.binding_id),
      binding = await this.binding(tx, owner, claim.binding_id);
    if (
      grant.state !== "active" ||
      grant.revision !== claim.credential_revision ||
      grant.refresh_fence !== claim.fence ||
      !grant.refresh_secret ||
      binding.purpose !== "oauth.refresh"
    )
      throw new AppError("mcp_oauth_conflict", 409);
    await this.final(tx, owner, tokenBinding, runtime);
    const now = await this.final(
      tx,
      owner,
      binding,
      runtime,
      undefined,
      tokenBinding,
    );
    if (new Date(claim.deadline) <= now || new Date(grant.expires_at) <= now)
      throw new AppError("mcp_oauth_expired", 409);
    return { grant, tokenBinding, binding };
  }
  async enterRefresh(owner: string, id: string, expectedRevision: number) {
    this.gate();
    const runtime = this.runtime();
    return this.transaction(async (tx) => {
      const claim = await this.claim(tx, owner, id, expectedRevision);
      if (claim.state !== "reserved")
        throw new AppError("mcp_oauth_refresh_replay", 409);
      const { grant, tokenBinding, binding } = await this.refreshContext(
        tx,
        owner,
        claim,
        runtime,
      );
      const token = openOAuthSecret(
        grant.refresh_secret as SealedOAuthSecret,
        this.secretBinding(tokenBinding, grant.id, grant.revision, "refresh"),
        runtime,
      );
      const [entered] = await tx.execute<Claim>(
        sql`UPDATE mcp_oauth_refresh SET state='entered',revision=revision+1 WHERE id=${id} AND revision=${expectedRevision} RETURNING *`,
      );
      await this.final(tx, owner, tokenBinding, runtime);
      const now = await this.final(
        tx,
        owner,
        binding,
        runtime,
        undefined,
        tokenBinding,
      );
      if (new Date(claim.deadline) <= now || new Date(grant.expires_at) <= now)
        throw new AppError("mcp_oauth_expired", 409);
      return { ...claimView(entered), refreshToken: token };
    });
  }
  async replaceFixtureRefresh(
    owner: string,
    id: string,
    expectedRevision: number,
    raw: unknown,
  ) {
    this.gate();
    const input = parseOAuth(replacementSchema, raw),
      runtime = this.runtime();
    return this.transaction(async (tx) => {
      const claim = await this.claim(tx, owner, id, expectedRevision);
      if (claim.state !== "entered")
        throw new AppError("mcp_oauth_refresh_replay", 409);
      const { grant, tokenBinding, binding } = await this.refreshContext(
        tx,
        owner,
        claim,
        runtime,
      );
      const now = await this.now(tx);
      if (
        new Date(input.expiresAt) <= now ||
        new Date(input.expiresAt) > new Date(tokenBinding.manifest.expiresAt)
      )
        throw new AppError("mcp_oauth_expired", 409);
      const updated = await this.resealGrant(
        tx,
        grant,
        tokenBinding,
        runtime,
        input.accessToken,
        input.refreshToken,
        input.expiresAt,
      );
      await tx.execute(
        sql`UPDATE mcp_oauth_refresh SET state='replaced',revision=revision+1 WHERE id=${id} AND revision=${expectedRevision}`,
      );
      await this.final(tx, owner, tokenBinding, runtime);
      const final = await this.final(
        tx,
        owner,
        binding,
        runtime,
        undefined,
        tokenBinding,
      );
      if (
        new Date(claim.deadline) <= final ||
        new Date(input.expiresAt) <= final ||
        new Date(grant.expires_at) <= final
      )
        throw new AppError("mcp_oauth_expired", 409);
      return grantView(updated);
    });
  }
  async cancelRefresh(owner: string, id: string, expectedRevision: number) {
    return this.transaction(async (tx) => {
      const claim = await this.claim(tx, owner, id, expectedRevision);
      if (claim.state !== "reserved")
        throw new AppError("mcp_oauth_entry_not_disproved", 409);
      const [cancelled] = await tx.execute<Claim>(
        sql`UPDATE mcp_oauth_refresh SET state='cancelled',revision=revision+1 WHERE id=${id} AND revision=${expectedRevision} RETURNING *`,
      );
      return claimView(cancelled);
    });
  }
  async retainRefreshUnknown(
    owner: string,
    id: string,
    expectedRevision: number,
  ) {
    return this.transaction(async (tx) => {
      const claim = await this.claim(tx, owner, id, expectedRevision);
      if (claim.state !== "entered")
        throw new AppError("mcp_oauth_conflict", 409);
      const [unknown] = await tx.execute<Claim>(
        sql`UPDATE mcp_oauth_refresh SET state='unknown',revision=revision+1 WHERE id=${id} AND revision=${expectedRevision} RETURNING *`,
      );
      await tx.execute(
        sql`UPDATE mcp_oauth_grant SET state='uncertain',revision=revision+1 WHERE id=${claim.grant_id} AND state='active'`,
      );
      await tx.execute(
        sql`INSERT INTO mcp_oauth_record(id,actor_key,kind,day) SELECT ${`unknown:${claim.id}`},r.actor_key,'unknown',(clock_timestamp() AT TIME ZONE 'UTC')::date FROM mcp_oauth_record r WHERE r.id=${claim.id} AND r.kind='refresh'`,
      );
      return claimView(unknown);
    });
  }
  async metadata(owner: string): Promise<OAuthGrantView[]> {
    try {
      const rows = await this.options.db.execute<{
        id: string;
        binding_id: string;
        revision: number;
        state: OAuthGrantView["state"];
        expires_at: Date;
        has_refresh_token: boolean;
      }>(
        sql`SELECT id,binding_id,revision,state,expires_at,refresh_secret IS NOT NULL AS has_refresh_token FROM mcp_oauth_grant WHERE user_id=${owner} ORDER BY created_at,id LIMIT 100`,
      );
      return rows.map((row) =>
        Object.freeze({
          id: row.id,
          bindingId: row.binding_id,
          revision: row.revision,
          state: row.state,
          expiresAt: new Date(row.expires_at).toISOString(),
          hasRefreshToken: row.has_refresh_token,
        }),
      );
    } catch (error: unknown) {
      throw storageError(error);
    }
  }
  async refreshStatus(owner: string, id: string) {
    return this.transaction(async (tx) => {
      const [row] = await tx.execute<Claim>(
        sql`SELECT * FROM mcp_oauth_refresh WHERE id=${id} AND user_id=${owner}`,
      );
      if (!row) throw new AppError("not_found", 404);
      return claimView(row);
    });
  }
  private async invalidate(tx: Tx, owner: string, connectionId: string) {
    await tx.execute(
      sql`INSERT INTO mcp_oauth_record(id,actor_key,kind,day) SELECT 'unknown:'||c.id,r.actor_key,'unknown',(clock_timestamp() AT TIME ZONE 'UTC')::date FROM mcp_oauth_refresh c JOIN mcp_oauth_record r ON r.id=c.id WHERE c.user_id=${owner} AND c.state='entered' AND c.grant_id IN (SELECT id FROM mcp_oauth_grant WHERE connection_id=${connectionId}) ON CONFLICT DO NOTHING`,
    );
    await tx.execute(
      sql`UPDATE mcp_oauth_state SET state='revoked',verifier=NULL,revision=revision+1 WHERE user_id=${owner} AND binding_id IN (SELECT id FROM mcp_oauth_binding WHERE connection_id=${connectionId}) AND state IN ('pending','consumed')`,
    );
    await tx.execute(
      sql`UPDATE mcp_oauth_refresh SET state=CASE WHEN state='entered' THEN 'unknown' ELSE 'cancelled' END,revision=revision+1 WHERE user_id=${owner} AND grant_id IN (SELECT id FROM mcp_oauth_grant WHERE connection_id=${connectionId}) AND state IN ('reserved','entered')`,
    );
    await tx.execute(
      sql`UPDATE mcp_oauth_grant SET state='revoked',access_secret=NULL,refresh_secret=NULL,revision=revision+1 WHERE user_id=${owner} AND connection_id=${connectionId} AND state<>'revoked'`,
    );
  }
  async revokeBinding(owner: string, id: string, expectedRevision: number) {
    return this.transaction(async (tx) => {
      const binding = await this.binding(tx, owner, id);
      cas(binding.revision, expectedRevision);
      if (binding.state !== "configured")
        throw new AppError("mcp_oauth_conflict", 409);
      await this.invalidate(tx, owner, binding.connection_id);
      await tx.execute(
        sql`UPDATE mcp_oauth_binding SET state='revoked',revision=revision+1 WHERE id=${id} AND revision=${expectedRevision}`,
      );
      return {
        id,
        revision: expectedRevision + 1,
        state: "locally_revoked" as const,
      };
    });
  }
  async deleteBinding(owner: string, id: string, expectedRevision: number) {
    return this.transaction(async (tx) => {
      const binding = await this.binding(tx, owner, id);
      cas(binding.revision, expectedRevision);
      await this.invalidate(tx, owner, binding.connection_id);
      await tx.execute(
        sql`DELETE FROM mcp_oauth_binding WHERE id=${id} AND user_id=${owner} AND revision=${expectedRevision}`,
      );
    });
  }
}
export function createMcpOAuthStore(options: { db?: Database } = {}) {
  const store = new OAuthStore(
    {
      db: options.db ?? requireDb(),
      runtime: () => undefined,
      env: () => process.env,
    },
    false,
  );
  return {
    issueBinding: store.issueBinding.bind(store),
    beginState: store.beginState.bind(store),
    consumeState: store.consumeState.bind(store),
    installFixtureGrant: store.installFixtureGrant.bind(store),
    openAccess: store.openAccess.bind(store),
    rotate: store.rotate.bind(store),
    reserveRefresh: store.reserveRefresh.bind(store),
    enterRefresh: store.enterRefresh.bind(store),
    replaceFixtureRefresh: store.replaceFixtureRefresh.bind(store),
    metadata: store.metadata.bind(store),
    refreshStatus: store.refreshStatus.bind(store),
    cancelRefresh: store.cancelRefresh.bind(store),
    retainRefreshUnknown: store.retainRefreshUnknown.bind(store),
    revokeBinding: store.revokeBinding.bind(store),
    deleteBinding: store.deleteBinding.bind(store),
  };
}
/** Offline authority and synthetic secret handling only; NODE_ENV is checked again at every final observation. */
export function createFixtureMcpOAuthStore(options: Options) {
  oauthFixtureGate();
  return new OAuthStore(options, true);
}
