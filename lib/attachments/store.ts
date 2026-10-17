import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { AttachmentConfig } from "@/lib/attachments/config";
import type { FileDescription } from "@/lib/attachments/content";
import {
  type AttachmentKind,
  type AttachmentView,
  attachmentLimits,
} from "@/lib/attachments/contract";
import type { Extraction } from "@/lib/attachments/extract";
import { requireDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";

type Db = ReturnType<typeof requireDb>;
export type AttachmentExecutor = Pick<Db, "execute">;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type AttachmentRow = {
  id: string;
  user_id: string;
  chat_id: string;
  object_key: string;
  bucket: string;
  name: string;
  media_type: string;
  kind: AttachmentKind;
  bytes: number;
  state: "processing" | "ready" | "deleting";
  upload_state: "reserved" | "entered" | "terminal";
  extracted_text: string;
  pages: number | null;
  sha256: string | null;
  created_at: Date;
  lease_until: Date;
};
export function attachmentView(row: AttachmentRow): AttachmentView {
  return {
    id: row.id,
    chatId: row.chat_id,
    name: row.name,
    mediaType: row.media_type,
    kind: row.kind,
    bytes: row.bytes,
    state: row.state,
    pages: row.pages,
    extractedCharacters: row.extracted_text.length,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
/** Shared lock is also used by account deletion/context entry integration. */
export async function lockAttachments(tx: AttachmentExecutor) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(41021410)`);
}
export async function readOwnedAttachment(
  db: AttachmentExecutor,
  userId: string,
  id: string,
) {
  const rows = await db.execute<AttachmentRow>(
    sql`SELECT a.* FROM attachment a JOIN chat c ON c.id=a.chat_id AND c.user_id=a.user_id WHERE a.user_id=${userId} AND a.id=${id}`,
  );
  if (!rows[0]) throw new AppError("not_found", 404);
  return rows[0];
}
function ownerKey(userId: string) {
  return createHash("sha256")
    .update(`galaxy-attachment-owner-v1:${userId}`)
    .digest("hex");
}
export class AttachmentStore {
  constructor(readonly db: Db = requireDb()) {}
  async ownedChat(userId: string, chatId: string) {
    const rows = await this.db.execute(
      sql`SELECT id FROM chat WHERE id=${chatId} AND user_id=${userId}`,
    );
    if (!rows[0]) throw new AppError("not_found", 404);
  }
  async list(userId: string, chatId: string) {
    await this.ownedChat(userId, chatId);
    return this.db.execute<AttachmentRow>(
      sql`SELECT * FROM attachment WHERE user_id=${userId} AND chat_id=${chatId} ORDER BY created_at LIMIT 20`,
    );
  }
  async owned(userId: string, id: string) {
    return readOwnedAttachment(this.db, userId, id);
  }
  private async transfer(tx: Tx, bytes: number, config: AttachmentConfig) {
    // Bill a minimum per operation to bound tiny-file request/metadata amplification.
    const billed = Math.max(bytes, 65_536);
    const rows =
      await tx.execute(sql`INSERT INTO attachment_transfer_budget(day,bytes) SELECT (now() AT TIME ZONE 'UTC')::date,${billed} WHERE ${billed}::bigint<=${config.dailyTransferBytes}::bigint
   ON CONFLICT(day) DO UPDATE SET bytes=attachment_transfer_budget.bytes+EXCLUDED.bytes WHERE attachment_transfer_budget.bytes+EXCLUDED.bytes<=${config.dailyTransferBytes} RETURNING day`);
    if (!rows[0]) throw new AppError("attachment_transfer_limit", 429);
    await tx.execute(
      sql`DELETE FROM attachment_transfer_budget WHERE day<(now() AT TIME ZONE 'UTC')::date-35`,
    );
  }
  async reserve(
    userId: string,
    chatId: string,
    file: FileDescription,
    config: AttachmentConfig,
  ) {
    if (!userId || userId.length > 128)
      throw new AppError("invalid_object", 400);
    const owner = ownerKey(userId);
    return this.db.transaction(async (tx) => {
      await lockAttachments(tx);
      const chat = await tx.execute(
        sql`SELECT id FROM chat WHERE id=${chatId} AND user_id=${userId} FOR UPDATE`,
      );
      if (!chat[0]) throw new AppError("not_found", 404);
      const totals = await tx.execute<{
        total: string;
        owned: string;
        count: string;
        user_count: string;
        active: string;
        owned_active: string;
      }>(sql`SELECT
    (COALESCE(SUM(bytes),0)+(SELECT COALESCE(SUM(bytes),0) FROM attachment_delete_queue))::text AS total,
    (COALESCE(SUM(bytes) FILTER(WHERE user_id=${userId}),0)+(SELECT COALESCE(SUM(bytes),0) FROM attachment_delete_queue WHERE split_part(object_key,'/',1)=${owner}))::text AS owned,
    (COUNT(*)+(SELECT COUNT(*) FROM attachment_delete_queue))::text AS count,
    (COUNT(*) FILTER(WHERE user_id=${userId})+(SELECT COUNT(*) FROM attachment_delete_queue WHERE split_part(object_key,'/',1)=${owner}))::text AS user_count,
    COUNT(*) FILTER(WHERE state='processing' AND lease_until>now())::text AS active,
    COUNT(*) FILTER(WHERE user_id=${userId} AND state='processing' AND lease_until>now())::text AS owned_active FROM attachment`);
      const t = totals[0];
      if (
        !t ||
        Number(t.total) + file.bytes > config.platformBytes ||
        Number(t.owned) + file.bytes > config.userBytes ||
        Number(t.count) >= 1000 ||
        Number(t.user_count) >= attachmentLimits.userFiles
      )
        throw new AppError("attachment_storage_limit", 413);
      if (Number(t.active) >= 2 || Number(t.owned_active) >= 1)
        throw new AppError("attachment_processing_limit", 429);
      await this.transfer(tx, file.bytes, config);
      const id = crypto.randomUUID();
      const key = `${owner}/${id}`;
      const rows =
        await tx.execute<AttachmentRow>(sql`INSERT INTO attachment(id,user_id,chat_id,object_key,bucket,name,media_type,kind,bytes,state,lease_until)
    VALUES(${id},${userId},${chatId},${key},${config.storage.bucket},${file.name},${file.mediaType},${file.kind},${file.bytes},'processing',now()+interval '5 minutes') RETURNING *`);
      return rows[0];
    });
  }
  async enterUpload(userId: string, id: string) {
    const rows = await this.db.execute(
      sql`UPDATE attachment SET upload_state='entered' WHERE user_id=${userId} AND id=${id} AND state='processing' AND upload_state='reserved' AND lease_until>now() RETURNING id`,
    );
    if (!rows[0]) throw new AppError("attachment_cancelled", 409);
  }
  async uploadTerminal(key: string) {
    await this.db.transaction(async (tx) => {
      await lockAttachments(tx);
      await tx.execute(
        sql`UPDATE attachment SET upload_state='terminal' WHERE object_key=${key}`,
      );
      await tx.execute(
        sql`UPDATE attachment_delete_queue SET upload_state='terminal',not_before=now() WHERE object_key=${key}`,
      );
    });
  }
  /** Operator-only: evidence must establish that a remote write cannot still land. */
  async reconcileUnknown(key: string, evidenceSha256: string) {
    if (
      !/^[a-f0-9]{64}\/[a-f0-9-]{36}$/.test(key) ||
      !/^[a-f0-9]{64}$/.test(evidenceSha256)
    )
      throw new AppError("invalid_reconciliation", 400);
    await this.db.transaction(async (tx) => {
      await lockAttachments(tx);
      const rows = await tx.execute(
        sql`UPDATE attachment_delete_queue SET upload_state='terminal',not_before=now() WHERE object_key=${key} AND upload_state='entered' RETURNING object_key`,
      );
      if (!rows[0]) throw new AppError("not_found", 404);
      await tx.execute(
        sql`INSERT INTO attachment_reconciliation(object_key,evidence_sha256) VALUES(${key},${evidenceSha256})`,
      );
    });
  }
  async complete(
    userId: string,
    id: string,
    result: Extraction,
    sha256: string,
  ) {
    const rows =
      await this.db.execute<AttachmentRow>(sql`UPDATE attachment SET state='ready',extracted_text=${result.text},pages=${result.pages},sha256=${sha256},lease_until=now()
   WHERE id=${id} AND user_id=${userId} AND state='processing' AND upload_state='terminal' AND lease_until>now() RETURNING *`);
    if (!rows[0]) throw new AppError("attachment_cancelled", 409);
    return rows[0];
  }
  async markDelete(userId: string, id: string) {
    return this.db.transaction(async (tx) => {
      await lockAttachments(tx);
      const rows = await tx.execute<AttachmentRow>(
        sql`UPDATE attachment SET state='deleting',extracted_text='' WHERE user_id=${userId} AND id=${id} RETURNING *`,
      );
      if (!rows[0]) throw new AppError("not_found", 404);
      await tx.execute(
        sql`DELETE FROM attachment WHERE user_id=${userId} AND id=${id}`,
      );
      return rows[0];
    });
  }
  async reserveRead(userId: string, id: string, config: AttachmentConfig) {
    return this.db.transaction(async (tx) => {
      await lockAttachments(tx);
      const rows = await tx.execute<AttachmentRow>(
        sql`SELECT a.* FROM attachment a JOIN chat c ON c.id=a.chat_id AND c.user_id=a.user_id WHERE a.id=${id} AND a.user_id=${userId} AND a.state='ready' FOR UPDATE OF a`,
      );
      if (!rows[0]) throw new AppError("attachment_not_ready", 409);
      await this.transfer(tx, rows[0].bytes, config);
      return rows[0];
    });
  }
  async expire() {
    await this.db.transaction(async (tx) => {
      await lockAttachments(tx);
      await tx.execute(
        sql`DELETE FROM attachment WHERE state='processing' AND lease_until<now()`,
      );
    });
  }
  async pendingDeletes(bucket: string, limit = 10) {
    return this.db.execute<{
      object_key: string;
      bucket: string;
      upload_state: "reserved" | "entered" | "terminal";
    }>(
      sql`SELECT object_key,bucket,upload_state FROM attachment_delete_queue WHERE bucket=${bucket} AND not_before<=now() ORDER BY created_at LIMIT ${Math.min(limit, 20)}`,
    );
  }
  async acknowledgeDelete(
    key: string,
    observedUploadState: "reserved" | "entered" | "terminal",
  ) {
    return this.db.transaction(async (tx) => {
      await lockAttachments(tx);
      if (observedUploadState === "entered") {
        // Even if a terminal callback raced this deletion, that write may have
        // landed after the delete began. Require another delete after proof.
        await tx.execute(
          sql`UPDATE attachment_delete_queue SET not_before=now()+interval '5 minutes' WHERE object_key=${key}`,
        );
        return false;
      }
      // A successful delete cannot establish an in-flight write's terminal state.
      const deleted = await tx.execute(
        sql`DELETE FROM attachment_delete_queue WHERE object_key=${key} AND upload_state<>'entered' AND not_before<=now() RETURNING object_key`,
      );
      if (deleted[0]) return true;
      await tx.execute(
        sql`UPDATE attachment_delete_queue SET not_before=now()+interval '5 minutes' WHERE object_key=${key} AND upload_state='entered'`,
      );
      return false;
    });
  }
}
