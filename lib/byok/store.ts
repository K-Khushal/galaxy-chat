import "server-only";
import { sql } from "drizzle-orm";
import type { EnvSource } from "@/lib/auth/env";
import { type EntryValidation, requireDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { BYOK_LIMITS, requireByok, resourceActor } from "./config";
import type { ByokProvider, ByokView, CredentialView } from "./contract";
import { openKey, sealKey } from "./crypto";

type Db = ReturnType<typeof requireDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Credential = {
  user_id: string;
  provider: ByokProvider;
  revision: string;
  key_version: string;
  nonce: string;
  ciphertext: string;
  test_state: CredentialView["testState"];
};
type Operation = {
  id: string;
  actor_key: string;
  provider: ByokProvider;
  credential_revision: string;
  state: "reserved" | "entered" | "held" | "complete" | "released";
  digest: string;
  kind: "chat" | "test";
};
const active = sql`state IN ('reserved','entered','held')`;
export async function lockByokResources(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(41021407)`);
}
async function credential(tx: Tx, userId: string, provider: ByokProvider) {
  const [row] = await tx.execute<Credential>(
    sql`SELECT * FROM provider_credential WHERE user_id=${userId} AND provider=${provider}`,
  );
  if (!row) throw new AppError("byok_key_missing", 403);
  return row;
}
function decrypt(row: Credential, env: EnvSource) {
  return openKey(
    {
      keyVersion: row.key_version,
      nonce: row.nonce,
      ciphertext: row.ciphertext,
    },
    { userId: row.user_id, provider: row.provider, revision: row.revision },
    env,
  );
}
export class ByokStore {
  constructor(private readonly db: Db = requireDb()) {}
  private transaction<T>(run: (tx: Tx) => Promise<T>) {
    return this.db.transaction(run, { isolationLevel: "read committed" });
  }
  async credentials(userId: string): Promise<CredentialView[]> {
    const rows = await this.db.execute<{
      provider: ByokProvider;
      masked_key: string;
      revision: string;
      test_state: CredentialView["testState"];
      tested_at: Date | null;
    }>(
      sql`SELECT provider,masked_key,revision,test_state,tested_at FROM provider_credential WHERE user_id=${userId} ORDER BY provider`,
    );
    return rows.map((r) => ({
      provider: r.provider,
      maskedKey: r.masked_key,
      revision: r.revision,
      testState: r.test_state,
      testedAt: r.tested_at ? new Date(r.tested_at).toISOString() : null,
    }));
  }
  async view(userId: string, env: EnvSource): Promise<ByokView> {
    const credentials = await this.credentials(userId);
    try {
      requireByok(env);
    } catch {
      return { configured: false, state: "disabled", credentials };
    }
    return this.transaction(async (tx) => {
      await lockByokResources(tx);
      const state = await this.limits(tx, resourceActor(userId, env));
      return { configured: true, state, credentials };
    });
  }
  private async limits(
    tx: Tx,
    actor: string,
    resourceUnits = 1,
  ): Promise<ByokView["state"]> {
    const [row] = await tx.execute<{
      actor_active: number;
      global_active: number;
      hourly: number;
      daily: number;
      global_daily: number;
      actor_records: number;
      global_records: number;
    }>(sql`
      SELECT count(*) FILTER(WHERE actor_key=${actor} AND ${active})::integer AS actor_active,
      count(*) FILTER(WHERE ${active})::integer AS global_active,
      COALESCE(sum(resource_units) FILTER(WHERE actor_key=${actor} AND created_at>=(date_trunc('hour',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')),0)::integer AS hourly,
      COALESCE(sum(resource_units) FILTER(WHERE actor_key=${actor} AND created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')),0)::integer AS daily,
      COALESCE(sum(resource_units) FILTER(WHERE created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')),0)::integer AS global_daily,
      count(*) FILTER(WHERE actor_key=${actor})::integer AS actor_records, count(*)::integer AS global_records FROM byok_operation`);
    if (
      row.actor_active >= BYOK_LIMITS.actorConcurrency ||
      row.global_active >= BYOK_LIMITS.globalConcurrency
    )
      return "busy";
    if (
      row.hourly + resourceUnits > BYOK_LIMITS.hourly ||
      row.daily + resourceUnits > BYOK_LIMITS.daily ||
      row.global_daily + resourceUnits > BYOK_LIMITS.globalDaily ||
      row.actor_records >= BYOK_LIMITS.actorRecords ||
      row.global_records >= BYOK_LIMITS.globalRecords
    )
      return "limited";
    return "available";
  }
  async save(
    userId: string,
    provider: ByokProvider,
    key: string,
    env: EnvSource,
    expectedRevision: string | null,
  ) {
    const revision = crypto.randomUUID();
    const sealed = sealKey(key, { userId, provider, revision }, env);
    await this.transaction(async (tx) => {
      await lockByokResources(tx);
      const [existing] = await tx.execute<{ revision: string }>(
        sql`SELECT revision FROM provider_credential WHERE user_id=${userId} AND provider=${provider}`,
      );
      if ((existing?.revision ?? null) !== expectedRevision)
        throw new AppError("byok_key_changed", 409);
      await tx.execute(
        sql`INSERT INTO provider_credential(user_id,provider,revision,key_version,nonce,ciphertext,masked_key) VALUES(${userId},${provider},${revision},${sealed.keyVersion},${sealed.nonce},${sealed.ciphertext},${`••••${key.slice(-4)}`}) ON CONFLICT(user_id,provider) DO UPDATE SET revision=excluded.revision,key_version=excluded.key_version,nonce=excluded.nonce,ciphertext=excluded.ciphertext,masked_key=excluded.masked_key,test_state='untested',tested_at=NULL,updated_at=now()`,
      );
    });
  }
  async delete(userId: string, provider: ByokProvider, revision: string) {
    await this.transaction(async (tx) => {
      await lockByokResources(tx);
      const rows = await tx.execute(
        sql`DELETE FROM provider_credential WHERE user_id=${userId} AND provider=${provider} AND revision=${revision} RETURNING provider`,
      );
      if (!rows.length) throw new AppError("byok_key_changed", 409);
    });
  }
  async rotate(userId: string, provider: ByokProvider, env: EnvSource) {
    await this.transaction(async (tx) => {
      await lockByokResources(tx);
      const row = await credential(tx, userId, provider);
      const sealed = sealKey(
        decrypt(row, env),
        { userId, provider, revision: row.revision },
        env,
      );
      await tx.execute(
        sql`UPDATE provider_credential SET key_version=${sealed.keyVersion},nonce=${sealed.nonce},ciphertext=${sealed.ciphertext},updated_at=now() WHERE user_id=${userId} AND provider=${provider} AND revision=${row.revision}`,
      );
    });
  }
  async reserve(options: {
    id: string;
    userId: string;
    provider: ByokProvider;
    kind: "chat" | "test";
    digest: string;
    env: EnvSource;
    revision?: string;
    resourceUnits?: 1 | 3;
  }) {
    requireByok(options.env);
    const actor = resourceActor(options.userId, options.env);
    const units = options.resourceUnits ?? 1;
    if (units !== 1 && units !== 3)
      throw new AppError("byok_resource_limited", 429);
    return this.transaction(async (tx) => {
      await lockByokResources(tx);
      const [prior] = await tx.execute<Operation>(
        sql`SELECT * FROM byok_operation WHERE id=${options.id}`,
      );
      if (prior)
        throw new AppError(
          prior.actor_key === actor && prior.digest !== options.digest
            ? "idempotency_conflict"
            : "request_already_processed",
          409,
        );
      const state = await this.limits(tx, actor, units);
      if (state !== "available")
        throw new AppError(
          state === "busy" ? "byok_busy" : "byok_resource_limited",
          429,
        );
      const row = await credential(tx, options.userId, options.provider);
      if (options.revision && options.revision !== row.revision)
        throw new AppError("byok_key_changed", 409);
      if (options.kind === "chat" && row.test_state === "invalid")
        throw new AppError("byok_key_invalid", 403);
      await tx.execute(
        sql`INSERT INTO byok_operation(id,actor_key,provider,credential_revision,kind,digest,state,resource_units) VALUES(${options.id},${actor},${options.provider},${row.revision},${options.kind},${options.digest},'reserved',${units})`,
      );
      return row.revision;
    });
  }
  /** Commit entry before execution. Replacement/delete serialize against this check.
   * A key already in use cannot be recalled from the remote provider. */
  async enter(
    id: string,
    userId: string,
    env: EnvSource,
    validateEntry?: EntryValidation,
  ) {
    requireByok(env);
    const actor = resourceActor(userId, env);
    return this.transaction(async (tx) => {
      await lockByokResources(tx);
      const [operation] = await tx.execute<Operation>(
        sql`SELECT * FROM byok_operation WHERE id=${id} AND actor_key=${actor}`,
      );
      if (!operation || operation.state !== "reserved")
        throw new AppError("request_already_processed", 409);
      const row = await credential(tx, userId, operation.provider);
      if (row.revision !== operation.credential_revision)
        throw new AppError("byok_key_changed", 409);
      if (operation.kind === "chat" && row.test_state === "invalid")
        throw new AppError("byok_key_invalid", 403);
      const key = decrypt(row, env);
      // Use only this transaction queue for the final owned-context check.
      await validateEntry?.(tx);
      await tx.execute(
        sql`UPDATE byok_operation SET state='entered',updated_at=now() WHERE id=${id} AND actor_key=${actor}`,
      );
      return key;
    });
  }
  async finish(
    id: string,
    userId: string,
    kind: "before_entry" | "terminal" | "unknown",
    env: EnvSource = process.env,
  ) {
    const actor = resourceActor(userId, env);
    await this.transaction(async (tx) => {
      await lockByokResources(tx);
      await tx.execute(
        sql`UPDATE byok_operation SET state=CASE WHEN state='reserved' AND ${kind}='before_entry' THEN 'released' WHEN state IN ('entered','held') AND ${kind}='terminal' THEN 'complete' WHEN state IN ('entered','held') THEN 'held' ELSE state END,updated_at=now() WHERE id=${id} AND actor_key=${actor} AND state IN ('reserved','entered','held')`,
      );
    });
  }
  async tested(
    userId: string,
    provider: ByokProvider,
    revision: string,
    state: CredentialView["testState"],
  ) {
    await this.db.execute(
      sql`UPDATE provider_credential SET test_state=${state},tested_at=now() WHERE user_id=${userId} AND provider=${provider} AND revision=${revision}`,
    );
  }
}
