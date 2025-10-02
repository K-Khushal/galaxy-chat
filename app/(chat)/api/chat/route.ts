import {
  convertUIMessageToChatMessage,
  createChat,
  getChatById,
  saveChatMessage,
} from "@/lib/actions/chat/chat";
import { chatApiRequestSchema } from "@/lib/schema/chat/chat";
import { auth } from "@clerk/nextjs/server";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    // Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Parse and validate request body
    const body = await req.json();
    const validatedData = chatApiRequestSchema.parse(body);

    const { messages: rawMessages, model, chatId, chatTitle } = validatedData;

    // Cast messages to UIMessage type (since we validated the structure)
    const messages = rawMessages as UIMessage[];

    // Determine chat ID - create new chat if needed
    let currentChatId = chatId;

    if (!currentChatId && messages.length > 0) {
      // Create new chat with title from first user message or provided title
      const firstUserMessage = messages.find((m) => m.role === "user");
      const firstTextPart = firstUserMessage?.parts?.find(
        (p) => p.type === "text",
      );
      const title =
        chatTitle ||
        (firstTextPart && "text" in firstTextPart
          ? firstTextPart.text.slice(0, 50) + "..."
          : "New Chat");

      const newChat = await createChat({ title });
      currentChatId = newChat.id;
    }

    // Verify chat exists and user has access (for existing chats)
    if (currentChatId) {
      const chat = await getChatById(currentChatId);
      if (!chat) {
        return new Response("Chat not found or access denied", { status: 404 });
      }
    }

    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });

    // Convert UI messages to model messages - this handles file conversion automatically
    const modelMessages = convertToModelMessages(messages);

    const result = streamText({
      model: openrouter.chat(model),
      messages: modelMessages,
      system:
        "You are a helpful assistant that can answer questions and help with tasks. You can see and analyze images that are shared with you. When a user shares an image, describe what you see in detail.",
      onFinish: async (result) => {
        try {
          if (!currentChatId) return;

          // Save all messages to database
          for (const message of messages) {
            const messageData = convertUIMessageToChatMessage(message);
            await saveChatMessage({
              chatId: currentChatId,
              ...messageData,
            });
          }

          // Save the assistant's response
          if (result.text) {
            await saveChatMessage({
              chatId: currentChatId,
              role: "assistant",
              parts: [{ type: "text", text: result.text }],
              attachments: [],
            });
          }
        } catch (error) {
          console.error("Error saving messages to database:", error);
          // Don't fail the request if database save fails
        }
      },
    });

    const response = result.toUIMessageStreamResponse({
      sendSources: true,
      sendReasoning: true,
    });

    // Add chat ID to response headers for client to track
    if (currentChatId) {
      response.headers.set("X-Chat-ID", currentChatId);
    }

    return response;
  } catch (error) {
    console.error("Chat API error:", error);

    if (error instanceof Error && error.message.includes("parse")) {
      return new Response("Invalid request format", { status: 400 });
    }

    return new Response("Internal server error", { status: 500 });
  }
}
