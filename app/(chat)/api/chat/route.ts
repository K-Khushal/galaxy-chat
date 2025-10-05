import {
  createChat,
  getChat,
  updateChatLastContext,
} from "@/lib/actions/chat/chat";
import {
  createMessage,
  createMultipleMessages,
  getChatMessages,
} from "@/lib/actions/chat/chat-message";
import type { ChatModel } from "@/lib/ai/model";
import type { AppUsage } from "@/lib/ai/usage";
import { convertToUIMessages } from "@/lib/ai/utils";
import {
  type PostRequestBody,
  postRequestBodySchema,
} from "@/lib/schema/chat/chat";
import type { ChatVisibility, TypeUIMessage } from "@/lib/types";
import { auth } from "@clerk/nextjs/server";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  streamText,
} from "ai";
import { unstable_cache as cache } from "next/cache";
import { NextResponse } from "next/server";
import type { ModelCatalog } from "tokenlens/core";
import { fetchModels } from "tokenlens/fetch";
import { getUsage } from "tokenlens/helpers";
import { v4 as uuidv4 } from "uuid";
import { generateChatTitle } from "../../action";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

const systemPrompt =
  "You are a helpful assistant that can answer questions and help with tasks. You can see and analyze images that are shared with you. When a user shares an image, describe what you see in detail.";

const getTokenlensCatalog = cache(
  async (): Promise<ModelCatalog | undefined> => {
    try {
      return await fetchModels();
    } catch (err) {
      console.warn(
        "TokenLens: catalog fetch failed, using default catalog",
        err,
      );
      return; // tokenlens helpers will fall back to defaultCatalog
    }
  },
  ["tokenlens-catalog"],
  { revalidate: 24 * 60 * 60 }, // 24 hours
);

export async function POST(req: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await req.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    console.error("Invalid request body", _);
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  try {
    const {
      id,
      message,
      model,
      webSearch,
      visibility,
    }: {
      id: string;
      message: TypeUIMessage;
      model: ChatModel["id"];
      webSearch: boolean;
      visibility: ChatVisibility;
    } = requestBody;

    const { isAuthenticated, userId } = await auth();

    if (!isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const chat = await getChat(id);

    if (chat) {
      if (chat.userId !== userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else {
      const title = await generateChatTitle({ message });

      await createChat({
        id,
        userId,
        title,
        visibility: visibility ?? "private",
      });
    }

    const previousMessages = await getChatMessages({ chatId: id });

    const chatMessages = [...convertToUIMessages(previousMessages), message];

    await createMessage({
      chatId: id,
      id: message.id,
      role: "user",
      parts: message.parts,
      attachments: [],
    });

    let finalMergedUsage: AppUsage | undefined;

    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        const result = streamText({
          model: webSearch
            ? "perplexity/sonar"
            : (model ?? "meta/llama-3.2-1b"),
          system: systemPrompt,
          messages: convertToModelMessages(chatMessages),
          onFinish: async ({ usage }) => {
            try {
              const providers = await getTokenlensCatalog();
              const modelId = model;
              if (!modelId) {
                finalMergedUsage = usage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
                return;
              }
              if (!providers) {
                finalMergedUsage = usage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
                return;
              }

              const summary = getUsage({ modelId, usage, providers });
              finalMergedUsage = { ...usage, ...summary, modelId } as AppUsage;
              dataStream.write({ type: "data-usage", data: finalMergedUsage });
            } catch (err) {
              console.warn("TokenLens enrichment failed", err);
              finalMergedUsage = usage;
              dataStream.write({ type: "data-usage", data: finalMergedUsage });
            }
          },
        });

        result.consumeStream();

        dataStream.merge(
          result.toUIMessageStream({
            sendSources: true,
            sendReasoning: true,
          }),
        );
      },
      generateId: uuidv4,
      onFinish: async ({ messages }) => {
        await createMultipleMessages(
          messages.map((currentMessage) => ({
            id: currentMessage.id,
            chatId: id,
            role: currentMessage.role,
            parts: currentMessage.parts,
            attachments: [],
          })),
        );

        if (finalMergedUsage) {
          try {
            await updateChatLastContext({
              chatId: id,
              context: finalMergedUsage,
            });
          } catch (err) {
            console.warn("Unable to persist last usage for chat", id, err);
          }
        }
      },
      onError: () => {
        return "Oops, an error occurred!";
      },
    });
    return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
  } catch (error) {
    console.error("Error in chat route", error);
    return NextResponse.json({ error: error }, { status: 500 });
  }
  // return result.toUIMessageStreamResponse({
  //   sendSources: true,
  //   sendReasoning: true,
  //   messageMetadata: ({ part }) => {
  //     if (part.type === "finish") {
  //       return { usage: part.totalUsage };
  //     }
  //   },
  // });
}
