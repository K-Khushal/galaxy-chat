import "server-only";
import type { UIMessage } from "ai";
import { requireChatAccess } from "@/lib/auth/access";

/** A local title has no auxiliary provider call or hidden funding cost. */
export async function generateChatTitle(
  requestHeaders: Headers,
  message: UIMessage,
) {
  await requireChatAccess(requestHeaders);
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
  return text.replace(/\s+/g, " ").trim().slice(0, 80) || "New chat";
}
