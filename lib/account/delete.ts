import "server-only";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/lib/api/context";
import { chat, user } from "@/lib/db/schema";
import { logErrorId } from "@/lib/errors";
import { stopGeneration } from "@/lib/generation/resume";

/** M6 integration point: replace this implementation with the uploads cleanup. */
export const attachmentCleanup: {
  deleteUserAttachments(userId: string): Promise<void>;
} = {
  async deleteUserAttachments(_userId) {},
};

export async function deleteAccount(ctx: AppContext, userId: string) {
  await ctx.db.transaction(async (tx) => {
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
      .where(eq(chat.userId, userId));
    for (const row of chats) await stopGeneration(ctx, row.id);
    // Cascades remove private data; credit_grant_identity has no User FK.
    await tx.delete(user).where(eq(user.id, userId));
  });
  // Idempotent storage cleanup can be retried independently after DB commit.
  // Never log the User ID, object paths or provider errors.
  try {
    await attachmentCleanup.deleteUserAttachments(userId);
  } catch {
    logErrorId("attachment_cleanup_failed");
    ctx.waitUntil(
      attachmentCleanup.deleteUserAttachments(userId).catch(() => {
        logErrorId("attachment_cleanup_retry_failed");
      }),
    );
  }
}
