import "server-only";
import { generateText } from "ai";
import type { AppContext } from "@/lib/api/context";
import { setTitleIfMissing } from "@/lib/chat/store";
import { logErrorId } from "@/lib/errors";
import { titleModel } from "@/lib/models";

const MAX_TITLE_LENGTH = 80;

export function cleanTitle(text: string): string | null {
  const title = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`*#\s]+|["'`*.\s]+$/g, "");
  if (!title) return null;
  return title.length > MAX_TITLE_LENGTH
    ? `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : title;
}

/**
 * Names a Chat after its first Reply, on the cheapest model. Never spends
 * Credits: it uses the same key that paid for the Reply. Failures only log.
 */
export async function generateChatTitle(
  ctx: Pick<AppContext, "db" | "languageModel">,
  input: { chatId: string; text: string; apiKey: string },
): Promise<void> {
  try {
    const { text } = await generateText({
      model: ctx.languageModel(titleModel().id, input.apiKey, {}),
      system:
        "Write a short title (at most six words) for a chat that starts with the user's message below. Reply with the title only, no quotes.",
      prompt: input.text.slice(0, 2_000),
      maxOutputTokens: 32,
      abortSignal: AbortSignal.timeout(15_000),
    });
    const title = cleanTitle(text);
    if (title) await setTitleIfMissing(ctx.db, input.chatId, title);
  } catch {
    logErrorId("chat_title_failed");
  }
}
