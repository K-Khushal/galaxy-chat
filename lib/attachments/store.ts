import "server-only";
import { and, asc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { AppContext } from "@/lib/api/context";
import {
  type AttachmentView,
  attachmentUrl,
  classifyFile,
  isPdfHeader,
  looksLikeText,
  MAX_FILE_BYTES,
  MAX_FILES_PER_MESSAGE,
  sniffImage,
} from "@/lib/attachments/rules";
import { ObjectChangedError } from "@/lib/attachments/storage";
import { attachment, attachmentTombstone, chat, user } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { AppError, logErrorId } from "@/lib/errors";

export type AttachmentRow = typeof attachment.$inferSelect;

/** What the dependencies of these functions are: no request needed. */
export type AttachmentDeps = Pick<AppContext, "db" | "storage">;

export type Upload = {
  attachment: AttachmentView;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
};

/** How long an upload URL works, and a read URL handed to the browser. */
export const UPLOAD_URL_SECONDS = 300;
const VIEW_URL_SECONDS = 300;
/** Unattached files older than this are deleted the next time their owner uploads. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Files uploaded but not yet sent in a Message, per User. */
export const MAX_UNATTACHED = 20;
/** Bytes checked for the text sniff. */
const SNIFF_BYTES = 8192;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function assertSafe(userId: string, attachmentId: string) {
  if (!SAFE_ID.test(userId) || !SAFE_ID.test(attachmentId)) {
    throw new Error("unsafe object key part");
  }
}

/** Immutable final key, also used by the browser's conditional PUT. */
export function objectKey(userId: string, attachmentId: string): string {
  assertSafe(userId, attachmentId);
  return `u/${userId}/${attachmentId}`;
}

export function attachmentView(row: AttachmentRow): AttachmentView {
  return {
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    contentType: row.contentType,
    size: row.size,
  };
}

/** A file part for a User Message; the model gets it resolved at send time. */
export function filePart(row: AttachmentRow) {
  return {
    type: "file" as const,
    mediaType: row.contentType,
    filename: row.filename,
    url: attachmentUrl(row.id),
  };
}

const notFound = () => new AppError("attachment_not_found", 404);

/** The Attachment when `userId` owns it; null otherwise (callers answer 404). */
export async function getOwnedAttachment(
  db: Db,
  userId: string,
  id: string,
): Promise<AttachmentRow | null> {
  if (!SAFE_ID.test(id)) return null;
  const rows = await db
    .select()
    .from(attachment)
    .where(and(eq(attachment.id, id), eq(attachment.userId, userId)));
  return rows[0] ?? null;
}

/** Retained independently of User/Chat cascades, including unknown in-flight PUTs. */
export async function recordTombstones(db: Db, rows: AttachmentRow[]) {
  if (!rows.length) return;
  await db
    .insert(attachmentTombstone)
    .values(
      rows.map((row) => ({
        id: row.id,
        key: objectKey(row.userId, row.id),
        purgeAfter: sql`greatest(now(), ${row.presignExpiresAt.toISOString()}::timestamptz)`,
      })),
    )
    .onConflictDoNothing();
}

/** The conditional transition competes atomically with a Message's claim. */
function markDeleting(db: Db, userId: string, condition: SQL | undefined) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(attachment)
      .set({ status: "deleted" })
      .where(
        and(
          eq(attachment.userId, userId),
          isNull(attachment.chatId),
          condition,
        ),
      )
      .returning();
    await recordTombstones(tx as unknown as Db, rows);
    return rows;
  });
}

/** URLs already expired at deletion need no late-PUT retention. */
async function settleExpired(db: Db, rows: AttachmentRow[]) {
  if (!rows.length) return;
  await db.delete(attachmentTombstone).where(
    and(
      inArray(
        attachmentTombstone.id,
        rows.map((row) => row.id),
      ),
      sql`${attachmentTombstone.purgeAfter} <= now()`,
    ),
  );
}

/** Early removal is useful, but the independent tombstone owns eventual purge. */
async function finishDeleting(deps: AttachmentDeps, rows: AttachmentRow[]) {
  if (!rows.length) return;
  await deps.storage.remove(rows.map((row) => objectKey(row.userId, row.id)));
  await settleExpired(deps.db, rows);
  await deps.db.delete(attachment).where(
    and(
      eq(attachment.status, "deleted"),
      inArray(
        attachment.id,
        rows.map((row) => row.id),
      ),
    ),
  );
}

/**
 * Tombstones survive cascades and track late PUTs for 24 hours after expiry.
 * Each key is independent: failed deletes back off so the backlog keeps moving.
 * All eligibility and retry times use the database clock.
 */
export async function purgeAttachments(deps: AttachmentDeps) {
  const rows = await deps.db
    .select()
    .from(attachmentTombstone)
    .where(
      and(
        sql`${attachmentTombstone.purgeAfter} < now()`,
        sql`${attachmentTombstone.nextPurgeAt} < now()`,
      ),
    )
    .orderBy(asc(attachmentTombstone.nextPurgeAt))
    .limit(100);
  for (const row of rows) {
    try {
      await deps.storage.remove([row.key]);
    } catch {
      await deps.db
        .update(attachmentTombstone)
        .set({
          attempts: sql`${attachmentTombstone.attempts} + 1`,
          nextPurgeAt: sql`now() + least(3600, 60 * power(2, least(${attachmentTombstone.attempts}, 6))) * interval '1 second'`,
        })
        .where(eq(attachmentTombstone.id, row.id));
      logErrorId("attachment_cleanup_failed");
      continue;
    }
    await deps.db
      .delete(attachment)
      .where(and(eq(attachment.status, "deleted"), eq(attachment.id, row.id)));
    // A successful delete after the retention window settles this key.
    const removed = await deps.db
      .delete(attachmentTombstone)
      .where(
        and(
          eq(attachmentTombstone.id, row.id),
          sql`${attachmentTombstone.purgeAfter} + interval '24 hours' < now()`,
        ),
      )
      .returning({ id: attachmentTombstone.id });
    if (!removed.length) {
      await deps.db
        .update(attachmentTombstone)
        .set({
          attempts: 0,
          nextPurgeAt: sql`now() + interval '1 hour'`,
        })
        .where(eq(attachmentTombstone.id, row.id));
    }
  }
}

export async function cleanupStaleAttachments(
  deps: AttachmentDeps,
  userId: string,
): Promise<number> {
  try {
    const taken = await markDeleting(
      deps.db,
      userId,
      sql`${attachment.createdAt} < now() - interval '24 hours'`,
    );
    await finishDeleting(deps, taken);
    await purgeAttachments(deps);
    return taken.length;
  } catch {
    logErrorId("attachment_cleanup_failed");
    return 0;
  }
}

export type UploadRequest = {
  filename: string;
  contentType: string;
  size: number;
};

/**
 * Records an Attachment and returns the URL the browser PUTs it to: a
 * final, immutable key. The URL signs the content type and
 * exact length, but a PUT proves nothing about the bytes and the URL stays
 * usable for five minutes: confirmUpload validates the object.
 */
export async function createUpload(
  deps: AttachmentDeps,
  userId: string,
  request: UploadRequest,
): Promise<Upload> {
  const classified = classifyFile(request.filename, request.contentType);
  if (!classified) throw new AppError("attachment_type_unsupported", 415);
  if (request.size > MAX_FILE_BYTES) {
    throw new AppError("attachment_too_large", 413);
  }
  if (!Number.isInteger(request.size) || request.size <= 0) {
    throw new AppError("invalid_request", 400);
  }
  await cleanupStaleAttachments(deps, userId);
  const [unattached] = await deps.db
    .select({ count: sql<number>`count(*)::int` })
    .from(attachment)
    .where(and(eq(attachment.userId, userId), isNull(attachment.chatId)));
  if ((unattached?.count ?? 0) >= MAX_UNATTACHED) {
    throw new AppError("attachment_limit", 429);
  }
  const id = crypto.randomUUID();
  // Lock the User against account deletion until the row is recorded.
  const row = await deps.db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("key share");
    if (!owner) throw notFound();
    const [inserted] = await tx
      .insert(attachment)
      .values({
        id,
        userId,
        filename: request.filename,
        kind: classified.kind,
        contentType: classified.contentType,
        size: request.size,
        // Signing is pinned to this timestamp, so delay cannot extend the URL.
        presignExpiresAt: new Date(
          Math.floor(Date.now() / 1000) * 1000 + UPLOAD_URL_SECONDS * 1000,
        ),
      })
      .returning();
    return inserted;
  });
  if (!row) throw new Error("attachment insert returned no row");
  const url = await deps.storage.presignPut(objectKey(userId, id), {
    contentType: classified.contentType,
    contentLength: request.size,
    expiresIn: UPLOAD_URL_SECONDS,
    signingDate: new Date(
      row.presignExpiresAt.getTime() - UPLOAD_URL_SECONDS * 1000,
    ),
  });
  return {
    attachment: attachmentView(row),
    upload: {
      url,
      method: "PUT",
      headers: { "Content-Type": classified.contentType, "If-None-Match": "*" },
    },
  };
}

/** Whether the first bytes of the object fit what the Attachment claims. */
function contentMatches(
  row: AttachmentRow,
  head: Uint8Array,
  complete: boolean,
): boolean {
  if (row.kind === "image") return sniffImage(head) === row.contentType;
  if (row.kind === "pdf") return isPdfHeader(head);
  return looksLikeText(head, !complete);
}

/**
 * Checks the object at `key` against the Attachment: its size and content type
 * are what was declared and its leading bytes match the type (magic bytes for
 * images and PDFs, UTF-8 text for text). `missing` when there is no object;
 * `etag` pins the ranged read to the inspected object.
 */
async function inspect(
  deps: AttachmentDeps,
  row: AttachmentRow,
  key: string,
): Promise<
  | { result: "missing" }
  | { result: "invalid" }
  | { result: "ok"; etag: string; size: number }
> {
  const head = await deps.storage.head(key);
  if (!head) return { result: "missing" };
  const withinLimits = head.size > 0 && head.size <= MAX_FILE_BYTES;
  if (
    !withinLimits ||
    head.size !== row.size ||
    head.contentType.split(";")[0]?.trim().toLowerCase() !== row.contentType
  ) {
    return { result: "invalid" };
  }
  try {
    const sniffed = await deps.storage.read(
      key,
      { start: 0, end: Math.min(head.size, SNIFF_BYTES) - 1 },
      head.etag,
    );
    if (!contentMatches(row, sniffed, head.size <= SNIFF_BYTES)) {
      return { result: "invalid" };
    }
  } catch (error) {
    // Rewritten between the check and the read.
    if (error instanceof ObjectChangedError) return { result: "invalid" };
    throw error;
  }
  return { result: "ok", etag: head.etag, size: head.size };
}

/** Validate immutable bytes, then conditionally mark ready. No storage writes. */
export async function confirmUpload(
  deps: AttachmentDeps,
  userId: string,
  id: string,
): Promise<AttachmentView> {
  await cleanupStaleAttachments(deps, userId);
  const row = await getOwnedAttachment(deps.db, userId, id);
  if (!row || row.status === "deleted") throw notFound();
  if (row.status === "ready") return attachmentView(row);
  const checked = await inspect(deps, row, objectKey(userId, id));
  if (checked.result === "missing")
    throw new AppError("attachment_not_uploaded", 409);
  if (checked.result === "invalid") {
    await finishDeleting(
      deps,
      await markDeleting(
        deps.db,
        userId,
        and(eq(attachment.id, id), eq(attachment.status, "pending")),
      ),
    );
    throw new AppError("attachment_invalid", 422);
  }
  const [ready] = await deps.db
    .update(attachment)
    .set({ status: "ready" })
    .where(
      and(
        eq(attachment.id, id),
        eq(attachment.userId, userId),
        eq(attachment.status, "pending"),
      ),
    )
    .returning();
  const current = ready ?? (await getOwnedAttachment(deps.db, userId, id));
  if (current?.status !== "ready") throw notFound();
  return attachmentView(current);
}

/** Delete competes with claim; tombstones survive removal and storage failures. */
export async function removeUnattached(
  deps: AttachmentDeps,
  userId: string,
  id: string,
): Promise<void> {
  if (!SAFE_ID.test(id)) throw notFound();
  const taken = await markDeleting(deps.db, userId, eq(attachment.id, id));
  if (!taken.length) {
    const row = await getOwnedAttachment(deps.db, userId, id);
    if (!row) throw notFound();
    throw new AppError("attachment_in_use", 409);
  }
  await finishDeleting(deps, taken);
}

/** A short-lived URL for opening a ready Attachment in the browser. */
export async function viewUrl(
  deps: AttachmentDeps,
  userId: string,
  id: string,
): Promise<string> {
  const row = await getOwnedAttachment(deps.db, userId, id);
  if (!row || row.status !== "ready") throw notFound();
  const safeName = row.filename
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  return deps.storage.presignGet(objectKey(userId, id), {
    contentType: row.contentType,
    // Images and PDFs open in the browser; text is always a download so that
    // a file is never rendered as a page.
    disposition: `${row.kind === "text" ? "attachment" : "inline"}; filename="${safeName}"`,
    expiresIn: VIEW_URL_SECONDS,
  });
}

/**
 * The ready Attachments a new User Message may use: `userId`'s own, not yet
 * used or already used in this Chat (an edit keeps its files). Throws
 * attachment_not_found if any is missing, someone else's or not ready.
 */
export async function loadForMessage(
  db: Db,
  userId: string,
  chatId: string,
  ids: readonly string[],
): Promise<AttachmentRow[]> {
  if (ids.length === 0) return [];
  if (ids.length > MAX_FILES_PER_MESSAGE || new Set(ids).size !== ids.length) {
    throw new AppError("invalid_request", 400);
  }
  const rows = await db
    .select()
    .from(attachment)
    .where(
      and(
        inArray(attachment.id, [...ids]),
        eq(attachment.userId, userId),
        eq(attachment.status, "ready"),
      ),
    )
    .orderBy(asc(attachment.createdAt));
  if (
    rows.length !== ids.length ||
    rows.some((row) => row.chatId !== null && row.chatId !== chatId)
  ) {
    throw notFound();
  }
  // Keep the order the User attached them in.
  return ids.map((id) => rows.find((row) => row.id === id) as AttachmentRow);
}

/**
 * Ties Attachments to a Chat inside the transaction that stores the Message.
 * The Chat row is locked first (`FOR NO KEY UPDATE`, which `deleteChatWithFiles`
 * conflicts with), then one conditional UPDATE claims each file: it must be
 * `ready` and owned by the User, with no Chat yet, or already in this Chat (an
 * edit keeps its files). A file that is pending, deleted, someone else's or
 * claimed elsewhere returns no row and fails the send, which rolls the
 * Message back.
 */
export async function claimForChat(
  tx: Pick<Db, "select" | "update">,
  userId: string,
  chatId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const [locked] = await tx
    .select({ id: chat.id })
    .from(chat)
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
    .for("no key update");
  if (!locked) throw notFound();
  const claimed = await tx
    .update(attachment)
    .set({ chatId })
    .where(
      and(
        inArray(attachment.id, [...ids]),
        eq(attachment.userId, userId),
        eq(attachment.status, "ready"),
        sql`(${attachment.chatId} IS NULL OR ${attachment.chatId} = ${chatId})`,
      ),
    )
    .returning({ id: attachment.id });
  if (claimed.length !== ids.length) throw notFound();
}

/**
 * Deletes a Chat and its files. In one transaction: lock the Chat row
 * (`FOR UPDATE`, so no send can claim a file for it from here on), list its
 * files, record independent tombstones, remove objects, then delete the Chat. If
 * storage fails the transaction rolls back and the Chat stays, so a retry can
 * finish the job. False when the User has no such Chat.
 */
export async function deleteChatWithFiles(
  deps: AttachmentDeps,
  userId: string,
  chatId: string,
): Promise<boolean> {
  return deps.db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: chat.id })
      .from(chat)
      .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
      .for("update");
    if (!locked) return false;
    const rows = await tx
      .select()
      .from(attachment)
      .where(and(eq(attachment.userId, userId), eq(attachment.chatId, chatId)));
    await recordTombstones(tx as unknown as Db, rows);
    if (rows.length > 0)
      await deps.storage.remove(
        rows.map((row) => objectKey(row.userId, row.id)),
      );
    await settleExpired(tx as unknown as Db, rows);
    await tx.delete(chat).where(eq(chat.id, chatId));
    return true;
  });
}

/** Called inside account deletion's User-locked transaction, before cascades. */
export async function tombstoneUserAttachments(db: Db, userId: string) {
  const rows = await db
    .update(attachment)
    .set({ status: "deleted" })
    .where(eq(attachment.userId, userId))
    .returning();
  await recordTombstones(db, rows);
  return rows.map((row) => objectKey(row.userId, row.id));
}

/** Account cleanup uses keys captured before the User cascade, without a sweep. */
export async function deleteUserAttachments(
  deps: AttachmentDeps,
  keys: string[],
): Promise<void> {
  let failed = false;
  for (const key of keys) {
    try {
      await deps.storage.remove([key]);
      await deps.db
        .delete(attachmentTombstone)
        .where(
          and(
            eq(attachmentTombstone.key, key),
            sql`${attachmentTombstone.purgeAfter} <= now()`,
          ),
        );
    } catch {
      failed = true;
    }
  }
  // Unexpired presigns retain tombstones after early deletes for late PUTs.
  if (failed) throw new Error("attachment cleanup failed");
}
