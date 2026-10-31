import "server-only";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/lib/api/context";
import { chat, user } from "@/lib/db/schema";
import { stopGeneration } from "@/lib/generation/resume";

/** M6 integration point: replace this implementation with the uploads cleanup. */
export const attachmentCleanup: {
  deleteUserAttachments(userId: string): Promise<void>;
} = {
  async deleteUserAttachments(_userId) {},
};

export async function deleteAccount(ctx: AppContext, userId: string) {
  const chats = await ctx.db
    .select({ id: chat.id })
    .from(chat)
    .where(eq(chat.userId, userId));
  for (const row of chats) await stopGeneration(ctx, row.id);
  await attachmentCleanup.deleteUserAttachments(userId);
  // Foreign keys cascade to Chats, Messages, keys, settings, sessions and accounts.
  // credit_grant_identity deliberately has no User foreign key (ADR 0003).
  await ctx.db.delete(user).where(eq(user.id, userId));
}
