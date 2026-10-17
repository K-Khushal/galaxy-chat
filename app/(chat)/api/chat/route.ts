import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  streamText,
  toUIMessageStream,
} from "ai";
import { unstable_cache as cache } from "next/cache";
import { NextResponse } from "next/server";
import type { ModelCatalog } from "tokenlens/core";
import { fetchModels } from "tokenlens/fetch";
import { getUsage } from "tokenlens/helpers";
import {
  createChat,
  deleteChat,
  getChatForUser,
  updateChatLastContext,
} from "@/lib/actions/chat/chat";
import {
  createMessage,
  createMultipleMessages,
  getChatMessages,
} from "@/lib/actions/chat/chat-message";
import { runFundedModelCall } from "@/lib/ai/funded";
import type { ChatModel } from "@/lib/ai/model";
import { generateChatTitle } from "@/lib/ai/title";
import type { AppUsage } from "@/lib/ai/usage";
import { convertToUIMessages, formatTitle } from "@/lib/ai/utils";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError, logErrorId } from "@/lib/errors";
import {
  type PostRequestBody,
  postRequestBodySchema,
} from "@/lib/schema/chat/chat";
import type { ChatVisibility, TypeUIMessage } from "@/lib/types";

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

const getTokenlensCatalog = cache(
  async (): Promise<ModelCatalog | undefined> => {
    try {
      return await fetchModels();
    } catch {
      logErrorId("catalog_unavailable");
      return;
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
  } catch {
    logErrorId("invalid_request");
    return NextResponse.json(
      { error: { id: "invalid_request" } },
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

    const access = await requireChatAccess(req.headers);
    const userId = access.userId;
    await runFundedModelCall(process.env, async () => undefined);
    const providerKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!providerKey) {
      throw new AppError("provider_unconfigured", 503);
    }

    const chat = await getChatForUser(id, userId);

    if (chat) {
      if (chat.userId !== userId) {
        return NextResponse.json(
          { error: { id: "forbidden" } },
          { status: 403 },
        );
      }
    } else {
      const title = await generateChatTitle(req.headers, message);
      const formattedTitle = formatTitle(title);

      await createChat({
        id,
        userId,
        title: formattedTitle,
        visibility: visibility ?? "private",
      });
    }

    const previousMessages = await getChatMessages({ chatId: id, userId });

    const chatMessages = [...convertToUIMessages(previousMessages), message];
    const memories: string[] = [];

    await createMessage({
      chatId: id,
      id: message.id,
      userId,
      role: "user",
      parts: message.parts,
      attachments: [],
    });

    let finalMergedUsage: AppUsage | undefined;

    // Open router configuration
    const openrouter = createOpenRouter({
      apiKey: providerKey,
    });

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const modelMessages = await convertToModelMessages(chatMessages);
        const result = streamText({
          model: openrouter.chat(
            webSearch ? "perplexity/sonar" : (model ?? "meta/llama-3.2-1b"),
          ),
          instructions: getSystemPrompt(memories),
          messages: modelMessages,
          onEnd: async ({ usage }) => {
            try {
              const providers = await getTokenlensCatalog();
              const modelId = model;
              if (!modelId || !providers) {
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
            } catch {
              logErrorId("usage_enrichment_failed");
              finalMergedUsage = usage;
              dataStream.write({ type: "data-usage", data: finalMergedUsage });
            }
          },
        });

        result.consumeStream();

        dataStream.merge(
          toUIMessageStream({
            sendReasoning: true,
            sendSources: true,
            stream: result.stream,
          }),
        );
      },
      generateId: () => crypto.randomUUID(),
      onEnd: async ({ messages }) => {
        await createMultipleMessages(
          messages.map((currentMessage) => ({
            id: currentMessage.id,
            chatId: id,
            role:
              currentMessage.role === "system" ||
              currentMessage.role === "user" ||
              currentMessage.role === "assistant"
                ? currentMessage.role
                : "assistant",
            parts: currentMessage.parts,
            attachments: [],
          })),
          userId,
        );

        if (finalMergedUsage) {
          try {
            await updateChatLastContext({
              chatId: id,
              userId,
              context: finalMergedUsage,
            });
          } catch {
            logErrorId("usage_persist_failed");
          }
        }
      },
      onError: () => "chat_failed",
    });
    return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
  } catch (error) {
    if (error instanceof AppError) {
      logErrorId(error.id);
      return NextResponse.json(
        { error: { id: error.id } },
        { status: error.status },
      );
    }
    logErrorId("chat_failed");
    return NextResponse.json({ error: { id: "chat_failed" } }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: { id: "invalid_chat" } },
      { status: 400 },
    );
  }

  const access = await requireChatAccess(request.headers);

  const chat = await getChatForUser(id, access.userId);

  if (!chat) {
    return NextResponse.json({ error: { id: "forbidden" } }, { status: 403 });
  }

  const deletedChat = await deleteChat(id, access.userId);

  return Response.json(deletedChat, { status: 200 });
}
