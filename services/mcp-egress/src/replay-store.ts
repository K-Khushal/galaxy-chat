import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { fail } from "./errors.js";

export interface ReplayStore {
  readonly durable: boolean;
  ready(): Promise<void>;
  consume(requestId: string, expiresAt: number, now: number): Promise<boolean>;
}
export class PostgresReplayStore implements ReplayStore {
  readonly durable = true;
  constructor(private readonly sql: ReturnType<typeof postgres>) {}
  async ready(): Promise<void> {
    // Check the real table/constraints and write permission before serving.
    // Rollback avoids leaving a health-check nonce behind.
    try {
      const rows = await this.sql<{ valid: boolean }[]>`
        select exists (
          select 1 from pg_constraint where conrelid = 'public.mcp_egress_nonce'::regclass
          and contype = 'p' and pg_get_constraintdef(oid) = 'PRIMARY KEY (request_id)'
        ) as valid`;
      if (!rows[0]?.valid) fail("unavailable");
      await this
        .sql`select request_id, expires_at from public.mcp_egress_nonce limit 0`;
      const probe = new Error("rollback-probe");
      try {
        await this.sql.begin(async (tx) => {
          await tx`insert into public.mcp_egress_nonce (request_id, expires_at)
            values (${randomUUID()}, ${new Date(Date.now() + 60_000)})`;
          throw probe;
        });
      } catch (error) {
        if (error !== probe) fail("unavailable");
      }
    } catch {
      fail("unavailable");
    }
  }
  async consume(
    requestId: string,
    expiresAt: number,
    _now: number,
  ): Promise<boolean> {
    try {
      // Unique insertion is the cross-instance arbitration point. Never delete
      // on a caller-supplied timestamp; cleanup is an operator DB-clock task.
      const rows = await this.sql`
        insert into public.mcp_egress_nonce (request_id, expires_at)
        values (${requestId}, ${new Date(expiresAt)})
        on conflict (request_id) do nothing returning request_id`;
      return rows.length === 1;
    } catch {
      fail("unavailable");
    }
  }
}
// Explicitly development/test only. Production startup rejects this store.
export class MemoryReplayStore implements ReplayStore {
  readonly durable = false;
  private readonly entries = new Map<string, number>();
  async ready(): Promise<void> {}
  async consume(
    requestId: string,
    expiresAt: number,
    now: number,
  ): Promise<boolean> {
    for (const [key, expiry] of this.entries)
      if (expiry < now) this.entries.delete(key);
    if (this.entries.has(requestId)) return false;
    if (this.entries.size >= 10_000) fail("busy");
    this.entries.set(requestId, expiresAt);
    return true;
  }
}
