"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteChat } from "./chat";

/**
 * Server action to delete a chat - can be called from client components
 */
export async function deleteChatAction(
  chatId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate input
    if (!chatId || typeof chatId !== "string") {
      return { success: false, error: "Invalid chat ID provided" };
    }

    console.log(`Attempting to delete chat: ${chatId}`);
    const success = await deleteChat(chatId);

    if (success) {
      console.log(`Successfully deleted chat: ${chatId}`);
      // Revalidate multiple paths to ensure UI updates
      revalidatePath("/chat");
      revalidatePath("/chat/[id]", "page");
      revalidatePath("/", "layout");

      return { success: true };
    } else {
      console.warn(`Failed to delete chat: ${chatId}`);
      return {
        success: false,
        error: "Chat not found or could not be deleted",
      };
    }
  } catch (error) {
    console.error("Error in deleteChatAction:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      success: false,
      error: `Delete operation failed: ${errorMessage}`,
    };
  }
}

/**
 * Server action to redirect after chat deletion
 */
export async function redirectAfterDelete() {
  redirect("/chat");
}
