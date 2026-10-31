import "server-only";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/lib/api/context";
import {
  deleteUserAttachments,
  tombstoneUserAttachments,
} from "@/lib/attachments/store";
import { chat, user } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { logErrorId } from "@/lib/errors";
import { stopGeneration } from "@/lib/generation/resume";

/** Bound M7 cleanup seam; injectable for storage-failure tests. */
export const attachmentCleanup: {
  deleteUserAttachments(keys: string[], ctx: AppContext): Promise<void>;
} = {
  async deleteUserAttachments(keys, ctx) {
    await deleteUserAttachments(ctx, keys);
  },
};

export async function deleteAccount(ctx: AppContext, userId: string) {
  const keys = await ctx.db.transaction(async (tx) => {
    // Serialize against payAndRecord. A Generation that already recorded its
    // Reply is stopped below; a later one cannot find the deleted User.
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    const chats = await tx
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.userId, userId))
      .for("update");
    for (const row of chats) await stopGeneration(ctx, row.id);
    const keys = await tombstoneUserAttachments(tx as unknown as Db, userId);
    // Cascades remove private data; credit_grant_identity has no User FK.
    await tx.delete(user).where(eq(user.id, userId));
    return keys;
  });
  // Idempotent storage cleanup can be retried independently after DB commit.
  // Never log the User ID, object paths or provider errors.
  try {
    await attachmentCleanup.deleteUserAttachments(keys, ctx);
  } catch {
    logErrorId("attachment_cleanup_failed");
    ctx.waitUntil(
      attachmentCleanup.deleteUserAttachments(keys, ctx).catch(() => {
        logErrorId("attachment_cleanup_retry_failed");
      }),
    );
  }
}
