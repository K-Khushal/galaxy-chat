import "server-only";
import {
  type AttachmentConfig,
  attachmentConfig,
} from "@/lib/attachments/config";
import {
  describeFile,
  readBounded,
  validateContent,
} from "@/lib/attachments/content";
import { extractAttachment } from "@/lib/attachments/extract";
import {
  type AttachmentStorage,
  SupabaseAttachmentStorage,
} from "@/lib/attachments/storage";
import { AttachmentStore, attachmentView } from "@/lib/attachments/store";
import { AppError, logErrorId } from "@/lib/errors";
export async function attachmentHash(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export class AttachmentService {
  constructor(
    readonly config: AttachmentConfig = attachmentConfig(),
    readonly store = new AttachmentStore(),
    readonly storage: AttachmentStorage = new SupabaseAttachmentStorage(
      config.storage,
    ),
  ) {}
  async cleanup(limit = 5) {
    await this.storage.assertPrivate();
    await this.store.expire();
    const pending = await this.store.pendingDeletes(
      this.config.storage.bucket,
      limit,
    );
    let deleted = 0;
    let held = 0;
    for (const row of pending) {
      await this.storage.remove(row.object_key);
      if (await this.store.acknowledgeDelete(row.object_key, row.upload_state))
        deleted++;
      else held++;
    }
    return { deleted, held };
  }
  async upload(userId: string, chatId: string, request: Request) {
    let name: string;
    try {
      name = decodeURIComponent(request.headers.get("x-attachment-name") ?? "");
    } catch {
      throw new AppError("invalid_filename", 400);
    }
    const declared = request.headers.get("content-length");
    if (!declared || !/^[1-9]\d*$/.test(declared))
      throw new AppError("attachment_length_required", 411);
    const file = describeFile(
      name,
      request.headers.get("content-type")?.split(";")[0] ?? "",
      Number(declared),
    );
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(45_000),
    ]);
    // Ownership/quota reservations precede bytes or any storage mutation.
    await this.store.ownedChat(userId, chatId);
    await this.storage.assertPrivate(signal);
    await this.cleanup();
    const row = await this.store.reserve(userId, chatId, file, this.config);
    let remoteMayWrite = false;
    try {
      const bytes = await readBounded(request.body, file.bytes, signal);
      validateContent(file, bytes);
      const result = await extractAttachment(file, bytes, signal);
      signal.throwIfAborted();
      await this.store.enterUpload(userId, row.id);
      signal.throwIfAborted();
      remoteMayWrite = true;
      await this.storage.upload(row.object_key, bytes, signal);
      await this.store.uploadTerminal(row.object_key);
      signal.throwIfAborted();
      return attachmentView(
        await this.store.complete(
          userId,
          row.id,
          result,
          await attachmentHash(bytes),
        ),
      );
    } catch (error) {
      // Queue survives storage failures and deletion while processing. Do not lose
      // the object key even when the remote write timed out with unknown outcome.
      if (!remoteMayWrite)
        await this.store.uploadTerminal(row.object_key).catch(() => {});
      await this.store.markDelete(userId, row.id).catch(() => {});
      if (signal.aborted)
        throw new AppError(
          request.signal.aborted
            ? "attachment_cancelled"
            : "attachment_processing_timeout",
          request.signal.aborted ? 499 : 408,
        );
      throw error;
    }
  }
  async list(userId: string, chatId: string) {
    return (await this.store.list(userId, chatId)).map(attachmentView);
  }
  async remove(userId: string, id: string) {
    await this.store.owned(userId, id);
    const deleted = await this.store.markDelete(userId, id);
    // A processing upload can still land; its lease delays cleanup safely.
    let cleanup: "complete_or_queued" | "reconciliation_required" | "pending" =
      deleted.upload_state === "entered"
        ? "reconciliation_required"
        : "complete_or_queued";
    try {
      await this.cleanup();
    } catch {
      cleanup = "pending";
      logErrorId("attachment_cleanup_pending");
    }
    return { deleted: true, cleanup };
  }
  async download(userId: string, id: string, signal?: AbortSignal) {
    await this.store.owned(userId, id);
    await this.storage.assertPrivate(signal);
    const row = await this.store.reserveRead(userId, id, this.config);
    if (row.bucket !== this.config.storage.bucket)
      throw new AppError("storage_unavailable", 503);
    const bytes = await this.storage.download(
      row.object_key,
      row.bytes,
      signal,
    );
    if (
      bytes.length !== row.bytes ||
      (await attachmentHash(bytes)) !== row.sha256
    )
      throw new AppError("attachment_integrity_failed", 503);
    await this.store.owned(userId, id);
    return { name: row.name, bytes };
  }
}

/** Post-cascade best effort: the durable queue retains failures/unknown liabilities. */
export async function cleanupAfterDeletion() {
  try {
    const { attachmentCleanupConfig } = await import(
      "@/lib/attachments/config"
    );
    const service = new AttachmentService(attachmentCleanupConfig());
    const result = await service.cleanup(20);
    return result.held
      ? ("reconciliation_required" as const)
      : ("complete_or_queued" as const);
  } catch {
    return "pending" as const;
  }
}
