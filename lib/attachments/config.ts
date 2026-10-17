import "server-only";
import { AppError } from "@/lib/errors";
import {
  type PrivateStorageConfig,
  privateStorageConfig,
} from "@/lib/storage/private";
export type AttachmentConfig = {
  storage: PrivateStorageConfig;
  platformBytes: number;
  userBytes: number;
  dailyTransferBytes: number;
};
function bounded(value: string | undefined, max: number) {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null;
}
/** No spending assumption: capacity must be reviewed alongside infrastructure costs. */
export function attachmentConfig(): AttachmentConfig {
  const storage = privateStorageConfig();
  const platformBytes = bounded(
    process.env.ATTACHMENT_PLATFORM_BYTES,
    100 * 1024 * 1024,
  );
  const userBytes = bounded(
    process.env.ATTACHMENT_USER_BYTES,
    20 * 1024 * 1024,
  );
  const dailyTransferBytes = bounded(
    process.env.ATTACHMENT_DAILY_TRANSFER_BYTES,
    100 * 1024 * 1024,
  );
  if (
    process.env.ATTACHMENTS_ENABLED !== "1" ||
    !storage ||
    !platformBytes ||
    !userBytes ||
    !dailyTransferBytes ||
    userBytes > platformBytes
  )
    throw new AppError("attachments_unavailable", 503);
  return { storage, platformBytes, userBytes, dailyTransferBytes };
}

/** Deletion remains operable while new uploads are disabled. No read/write capacity. */
export function attachmentCleanupConfig(): AttachmentConfig {
  const storage = privateStorageConfig();
  if (!storage) throw new AppError("storage_unconfigured", 503);
  return { storage, platformBytes: 0, userBytes: 0, dailyTransferBytes: 0 };
}
