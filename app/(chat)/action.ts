"use server";

import { headers } from "next/headers";
import { deleteOwnedTrailingFromMessage } from "@/lib/actions/chat/chat-message";

export async function deleteChatMessages(id: string) {
  await deleteOwnedTrailingFromMessage(await headers(), id);
}
