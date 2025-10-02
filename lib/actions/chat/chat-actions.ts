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

    const success = await deleteChat(chatId);

    if (success) {
      // Revalidate paths to ensure UI updates, but avoid revalidating the specific deleted chat
      revalidatePath("/chat");
      revalidatePath("/", "layout");

      return { success: true };
    } else {
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
