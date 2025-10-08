import {
  createChat,
  deleteChat,
  getChat,
  updateChatLastContext,
} from "@/lib/actions/chat/chat";
import {
  createMessage,
  createMultipleMessages,
  getChatMessages,
} from "@/lib/actions/chat/chat-message";
import { addMemories, retrieveMemories } from "@/lib/actions/mem0/memory";
import type { ChatModel } from "@/lib/ai/model";
import type { AppUsage } from "@/lib/ai/usage";
import { convertToUIMessages, formatTitle } from "@/lib/ai/utils";
import {
  type PostRequestBody,
  postRequestBodySchema,
} from "@/lib/schema/chat/chat";
import type { ChatVisibility, TypeUIMessage } from "@/lib/types";
import { auth } from "@clerk/nextjs/server";
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

const getSystemPrompt = (memories: string[] = []) => {
  const basePrompt =
    "You are a helpful assistant that can answer questions and help with tasks. You can see and analyze images that are shared with you. When a user shares an image, describe what you see in detail.";

  if (memories.length > 0) {
    const memoryContext = `\n\nRelevant context from previous conversations:\n${memories.join("\n")}`;
    return basePrompt + memoryContext;
  }

  return basePrompt;
};

type LanguageModelV1Prompt = any;

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
      const formattedTitle = formatTitle(title);

      await createChat({
        id,
        userId,
        title: formattedTitle,
        visibility: visibility ?? "private",
      });
    }

    const previousMessages = await getChatMessages({ chatId: id });

    const chatMessages = [...convertToUIMessages(previousMessages), message];

    // Retrieve relevant memories for context
    let memories: string[] = [];
    try {
      const messageText =
        message.parts.find((part) => part.type === "text")?.text ?? "";
      const retrievedMemories = await retrieveMemories(messageText, {
        user_id: userId,
      });

      // retrieveMemories returns a string, so we can use it directly
      if (retrievedMemories?.trim()) {
        memories = [retrievedMemories];
      }
    } catch (error) {
      console.warn("Failed to retrieve memories:", error);
    }

    await createMessage({
      chatId: id,
      id: message.id,
      role: "user",
      parts: message.parts,
      attachments: [],
    });

    let finalMergedUsage: AppUsage | undefined;

    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        const result = streamText({
          model: webSearch
            ? "perplexity/sonar"
            : (model ?? "meta/llama-3.2-1b"),
          system: getSystemPrompt(memories),
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

        // Store memories from the conversation
        try {
          // Convert messages to LanguageModelV1Prompt format using complete conversation
          const mem0Messages: LanguageModelV1Prompt = messages.map((msg) => ({
            role: msg.role as "user" | "assistant" | "system",
            content: msg.parts
              .filter((part) => part.type === "text")
              .map((part) => ({
                type: "text" as const,
                text: part.text,
              })),
          }));
          await addMemories(mem0Messages, { user_id: userId });
        } catch (error) {
          console.warn("Failed to store memories:", error);
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

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Invalid Chat" }, { status: 401 });
  }

  const { isAuthenticated, userId } = await auth();

  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chat = await getChat(id);

  if (chat?.userId !== userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deletedChat = await deleteChat(id);

  return Response.json(deletedChat, { status: 200 });
}
