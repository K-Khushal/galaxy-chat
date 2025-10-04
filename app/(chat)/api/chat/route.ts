import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  convertToModelMessages,
  type LanguageModelUsage,
  streamText,
  type UIMessage,
} from "ai";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

type UsageMetadata = {
  usage: LanguageModelUsage;
};

export type TypeUIMessage = UIMessage<UsageMetadata>;

export async function POST(req: Request) {
  const {
    messages,
    model,
    webSearch,
  }: {
    messages: TypeUIMessage[];
    model: string;
    webSearch: boolean;
  } = await req.json();

  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });

  // Convert UI messages to model messages - this handles file conversion automatically
  const modelMessages = convertToModelMessages(messages);

  const result = streamText({
    model: webSearch ? "perplexity/sonar" : (model ?? "meta/llama-3.2-1b"),
    messages: modelMessages,
    system:
      "You are a helpful assistant that can answer questions and help with tasks. You can see and analyze images that are shared with you. When a user shares an image, describe what you see in detail.",
  });

  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
    messageMetadata: ({ part }) => {
      if (part.type === "finish") {
        return { usage: part.totalUsage };
      }
    },
  });
}
