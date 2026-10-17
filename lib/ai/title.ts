import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type UIMessage } from "ai";
import { runAuthorizedFundedModelCall } from "@/lib/ai/authorized-model";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";

export async function generateChatTitle(
  requestHeaders: Headers,
  message: UIMessage,
) {
  return runAuthorizedFundedModelCall({
    authorize: () => requireChatAccess(requestHeaders),
    env: process.env,
    run: () => requestTitle(message),
  });
}

async function requestTitle(message: UIMessage) {
  const providerKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!providerKey) {
    throw new AppError("provider_unconfigured", 503);
  }
  const openrouter = createOpenRouter({ apiKey: providerKey });
  const { text: title } = await generateText({
    instructions:
      "Generate a short title, at most 80 characters, summarizing the user's message. Do not use quotes or colons.",
    model: openrouter.chat("openai/gpt-4o-mini"),
    prompt: JSON.stringify({
      role: message.role,
      parts: message.parts,
    }),
  });
  return title;
}
