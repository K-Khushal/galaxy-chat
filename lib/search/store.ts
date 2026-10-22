import "server-only";
import { sql } from "drizzle-orm";
import type { EnvSource } from "@/lib/auth/env";
import { BYOK_LIMITS, resourceActor } from "@/lib/byok/config";
import { validateKey } from "@/lib/byok/crypto";
import { lockByokResources } from "@/lib/byok/store";
import { type DatabaseTransaction, requireDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { resolveSearchConfig, type SearchConfig } from "./config";
import type { SearchSelection } from "./contract";
import { openSearchKey, sealSearchKey } from "./crypto";

type Db = ReturnType<typeof requireDb>;
type Credential = {
  user_id: string;
  provider: "tavily";
  revision: string;
  key_version: string;
  nonce: string;
  ciphertext: string;
  masked_key: string;
};
async function credential(tx: DatabaseTransaction, userId: string) {
  const [row] = await tx.execute<Credential>(
    sql`SELECT * FROM search_credential WHERE user_id=${userId} AND provider='tavily'`,
  );
  if (!row) throw new AppError("search_key_missing", 403);
  return row;
}
function decrypt(row: Credential, env: EnvSource) {
  return openSearchKey(
    {
      keyVersion: row.key_version,
      nonce: row.nonce,
      ciphertext: row.ciphertext,
    },
    { userId: row.user_id, provider: "tavily", revision: row.revision },
    env,
  );
}

export class SearchStore {
  constructor(private readonly db: Db = requireDb()) {}
  async credentials(userId: string) {
    const rows = await this.db.execute<{
      provider: "tavily";
      masked_key: string;
      revision: string;
    }>(
      sql`SELECT provider,masked_key,revision FROM search_credential WHERE user_id=${userId}`,
    );
    return rows.map((row) => ({
      provider: row.provider,
      maskedKey: row.masked_key,
      revision: row.revision,
    }));
  }
  async save(
    userId: string,
    key: string,
    expectedRevision: string | null,
    env: EnvSource,
  ) {
    validateKey(key);
    const revision = crypto.randomUUID();
    const sealed = sealSearchKey(
      key,
      { userId, provider: "tavily", revision },
      env,
    );
    await this.db.transaction(async (tx) => {
      await lockByokResources(tx);
      const [prior] = await tx.execute<{ revision: string }>(
        sql`SELECT revision FROM search_credential WHERE user_id=${userId} AND provider='tavily'`,
      );
      if ((prior?.revision ?? null) !== expectedRevision)
        throw new AppError("search_key_changed", 409);
      await tx.execute(
        sql`INSERT INTO search_credential(user_id,provider,revision,key_version,nonce,ciphertext,masked_key) VALUES(${userId},'tavily',${revision},${sealed.keyVersion},${sealed.nonce},${sealed.ciphertext},${`••••${key.slice(-4)}`}) ON CONFLICT(user_id,provider) DO UPDATE SET revision=excluded.revision,key_version=excluded.key_version,nonce=excluded.nonce,ciphertext=excluded.ciphertext,masked_key=excluded.masked_key,updated_at=now()`,
      );
    });
  }
  async delete(userId: string, revision: string) {
    await this.db.transaction(async (tx) => {
      await lockByokResources(tx);
      const rows = await tx.execute(
        sql`DELETE FROM search_credential WHERE user_id=${userId} AND provider='tavily' AND revision=${revision} RETURNING provider`,
      );
      if (!rows.length) throw new AppError("search_key_changed", 409);
    });
  }
  async reserve(options: {
    id: string;
    runId: string;
    callId: string;
    userId: string;
    selection: SearchSelection;
    config: SearchConfig;
    digest: string;
    env: EnvSource;
  }) {
    const actor = resourceActor(options.userId, options.env);
    const { caps, snapshot } = options.config;
    await this.db.transaction(async (tx) => {
      await lockByokResources(tx);
      const [prior] = await tx.execute(
        sql`SELECT id FROM byok_operation WHERE id=${options.id}`,
      );
      if (prior) throw new AppError("request_already_processed", 409);
      const key = await credential(tx, options.userId);
      if (key.revision !== options.selection.credentialRevision)
        throw new AppError("search_key_changed", 409);
      const [row] = await tx.execute<{
        actor_active: number;
        global_active: number;
        hourly: number;
        daily: number;
        global_daily: number;
        actor_search_hourly: number;
        actor_search_daily: number;
        global_search_daily: number;
        actor_spend: number;
        global_spend: number;
        actor_records: number;
        global_records: number;
      }>(sql`SELECT
        count(*) FILTER(WHERE actor_key=${actor} AND state IN ('reserved','entered','held') AND id<>${options.runId})::integer actor_active,
        count(*) FILTER(WHERE state IN ('reserved','entered','held') AND id<>${options.runId})::integer global_active,
        COALESCE(sum(resource_units) FILTER(WHERE actor_key=${actor} AND created_at>=date_trunc('hour',now())),0)::integer hourly,
        COALESCE(sum(resource_units) FILTER(WHERE actor_key=${actor} AND created_at>=date_trunc('day',now())),0)::integer daily,
        COALESCE(sum(resource_units) FILTER(WHERE created_at>=date_trunc('day',now())),0)::integer global_daily,
        count(*) FILTER(WHERE kind='search' AND actor_key=${actor} AND created_at>=date_trunc('hour',now()))::integer actor_search_hourly,
        count(*) FILTER(WHERE kind='search' AND actor_key=${actor} AND created_at>=date_trunc('day',now()))::integer actor_search_daily,
        count(*) FILTER(WHERE kind='search' AND created_at>=date_trunc('day',now()))::integer global_search_daily,
        COALESCE(sum(reserved_microdollars) FILTER(WHERE kind='search' AND state<>'released' AND actor_key=${actor} AND created_at>=date_trunc('day',now())),0)::integer actor_spend,
        COALESCE(sum(reserved_microdollars) FILTER(WHERE kind='search' AND state<>'released' AND created_at>=date_trunc('day',now())),0)::integer global_spend,
        count(*) FILTER(WHERE actor_key=${actor})::integer actor_records,
        count(*)::integer global_records
        FROM byok_operation`);
      const cost = snapshot.worstCaseMicrodollars;
      if (
        row.actor_active >= BYOK_LIMITS.actorConcurrency ||
        row.global_active >= BYOK_LIMITS.globalConcurrency ||
        row.hourly + 1 > BYOK_LIMITS.hourly ||
        row.daily + 1 > BYOK_LIMITS.daily ||
        row.global_daily + 1 > BYOK_LIMITS.globalDaily ||
        row.actor_records >= BYOK_LIMITS.actorRecords ||
        row.global_records >= BYOK_LIMITS.globalRecords ||
        row.actor_search_hourly + 1 > caps.actorHourlyRequests ||
        row.actor_search_daily + 1 > caps.actorDailyRequests ||
        row.global_search_daily + 1 > caps.globalDailyRequests ||
        row.actor_spend + cost > caps.actorDailyMicrodollars ||
        row.global_spend + cost > caps.globalDailyMicrodollars
      )
        throw new AppError("search_resource_limited", 429);
      await tx.execute(
        sql`INSERT INTO byok_operation(id,actor_key,provider,credential_revision,kind,digest,state,resource_units,price_revision,reserved_microdollars) VALUES(${options.id},${actor},'tavily',${key.revision},'search',${options.digest},'reserved',1,${snapshot.id},${cost})`,
      );
      const linked = await tx.execute(
        sql`UPDATE tool_call c SET search_operation_id=${options.id} FROM tool_run r WHERE c.run_id=${options.runId} AND c.id=${options.callId} AND c.name='webSearch' AND c.state='running' AND c.search_operation_id IS NULL AND r.id=c.run_id AND r.user_id=${options.userId} AND r.state='running' AND r.created_at>now()-interval '20 seconds' AND NOT EXISTS(SELECT 1 FROM tool_call x WHERE x.run_id=${options.runId} AND x.search_operation_id IS NOT NULL) RETURNING c.id`,
      );
      if (!linked.length) throw new AppError("search_entry_denied", 409);
    });
  }
  async enter(options: {
    id: string;
    runId: string;
    callId: string;
    userId: string;
    selection: SearchSelection;
    snapshot: SearchConfig["snapshot"];
    env: EnvSource;
  }) {
    const actor = resourceActor(options.userId, options.env);
    return this.db.transaction(async (tx) => {
      await lockByokResources(tx);
      const [operation] = await tx.execute<{
        state: string;
        credential_revision: string;
        price_revision: string;
        reserved_microdollars: number;
      }>(
        sql`SELECT o.state,o.credential_revision,o.price_revision,o.reserved_microdollars FROM byok_operation o JOIN tool_call c ON c.search_operation_id=o.id JOIN tool_run r ON r.id=c.run_id WHERE o.id=${options.id} AND o.actor_key=${actor} AND c.run_id=${options.runId} AND c.id=${options.callId} AND c.state='running' AND r.user_id=${options.userId} AND r.state='running' AND r.created_at>now()-interval '20 seconds'`,
      );
      // Resolve the final price proof only after the shared lock is held. A
      // stale pre-reservation read cannot authorize provider entry.
      const current = resolveSearchConfig(options.env);
      if (
        !operation ||
        !current ||
        operation.state !== "reserved" ||
        operation.credential_revision !==
          options.selection.credentialRevision ||
        operation.price_revision !== options.selection.priceRevision ||
        operation.reserved_microdollars !==
          options.selection.estimateMicrodollars ||
        JSON.stringify(current.snapshot) !== JSON.stringify(options.snapshot) ||
        current.snapshot.id !== operation.price_revision ||
        current.snapshot.worstCaseMicrodollars !==
          operation.reserved_microdollars
      )
        throw new AppError("search_entry_denied", 409);
      const row = await credential(tx, options.userId);
      if (row.revision !== operation.credential_revision)
        throw new AppError("search_key_changed", 409);
      const key = decrypt(row, options.env);
      await tx.execute(
        sql`UPDATE byok_operation SET state='entered',updated_at=now() WHERE id=${options.id} AND state='reserved'`,
      );
      return key;
    });
  }
  async finish(
    id: string,
    userId: string,
    kind: "before_entry" | "terminal" | "unknown",
    env: EnvSource,
  ) {
    const actor = resourceActor(userId, env);
    await this.db.transaction(async (tx) => {
      await lockByokResources(tx);
      await tx.execute(
        sql`UPDATE byok_operation SET state=CASE WHEN state='reserved' AND ${kind}='before_entry' THEN 'released' WHEN state IN ('entered','held') AND ${kind}='terminal' THEN 'complete' WHEN state IN ('entered','held') THEN 'held' ELSE state END,actual_microdollars=CASE WHEN ${kind}='terminal' THEN reserved_microdollars ELSE actual_microdollars END,receipt_credits=CASE WHEN ${kind}='terminal' THEN 1 ELSE receipt_credits END,updated_at=now() WHERE id=${id} AND actor_key=${actor} AND kind='search' AND state IN ('reserved','entered','held')`,
      );
    });
  }
}
