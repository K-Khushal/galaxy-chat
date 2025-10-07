import { ensureDb } from "@/lib/database/db";
import {
  ChatMessageModel,
  type IChatMessage,
} from "@/lib/database/models/chat-message";
import type { ChatMessageRole } from "@/lib/types";

export type ChatMessage = IChatMessage;

// Input validation types
export type CreateSingleMessageInput = {
  id: string;
  chatId: string;
  role: ChatMessageRole;
  parts: unknown[];
  attachments?: unknown[];
};

export type CreateMultipleMessagesInput = CreateSingleMessageInput[];

export type UpdateMessageInput = {
  id: string;
  parts?: unknown[];
  attachments?: unknown[];
};

export type GetMessagesInput = {
  chatId: string;
  limit?: number;
  offset?: number;
};

/**
 * Creates a single chat message
 */
export async function createMessage(
  input: CreateSingleMessageInput,
): Promise<ChatMessage> {
  await ensureDb();

  // Input validation
  if (!input.id?.trim()) {
    throw new Error("Message ID is required");
  }
  if (!input.chatId?.trim()) {
    throw new Error("Chat ID is required");
  }
  if (!input.role) {
    throw new Error("Message role is required");
  }
  if (!Array.isArray(input.parts)) {
    throw new Error("Message parts must be an array");
  }

  try {
    // Check if message already exists
    const existingMessage = await ChatMessageModel.findOne({ id: input.id })
      .lean<ChatMessage>()
      .exec();

    if (existingMessage) {
      return existingMessage;
    }

    const message = new ChatMessageModel({
      id: input.id.trim(),
      chatId: input.chatId.trim(),
      role: input.role,
      parts: input.parts,
      attachments: input.attachments || [],
    });

    const result = await message.save();
    return result.toObject();
  } catch (error: unknown) {
    // Handle MongoDB duplicate key error (code 11000)
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    ) {
      // Message was created by another request, fetch and return the existing message
      const existingMessage = await ChatMessageModel.findOne({ id: input.id })
        .lean<ChatMessage>()
        .exec();

      if (existingMessage) {
        return existingMessage;
      }
    }

    console.error("Failed to create message:", error);
    throw new Error("Failed to create message");
  }
}

/**
 * Updates an existing chat message
 */
export async function updateMessage(
  input: UpdateMessageInput,
): Promise<ChatMessage> {
  await ensureDb();

  if (!input.id?.trim()) {
    throw new Error("Message ID is required");
  }

  try {
    const updateData: Partial<
      Pick<CreateSingleMessageInput, "parts" | "attachments">
    > = {};

    if (input.parts !== undefined) {
      if (!Array.isArray(input.parts)) {
        throw new Error("Message parts must be an array");
      }
      updateData.parts = input.parts;
    }
    if (input.attachments !== undefined) {
      updateData.attachments = input.attachments;
    }

    const result = await ChatMessageModel.findOneAndUpdate(
      { id: input.id.trim() },
      { $set: updateData },
      { new: true, returnDocument: "after" },
    )
      .lean<ChatMessage>()
      .exec();

    if (!result) {
      throw new Error("Message not found");
    }

    return result;
  } catch (error: unknown) {
    console.error("Failed to update message:", error);
    throw new Error("Failed to update message");
  }
}

/**
 * Retrieves all messages for a specific chat with pagination
 */
export async function getChatMessages(
  input: GetMessagesInput,
): Promise<ChatMessage[]> {
  await ensureDb();

  if (!input.chatId?.trim()) {
    throw new Error("Chat ID is required");
  }

  const limit = Math.min(input.limit || 100, 500); // Cap at 500
  const offset = Math.max(input.offset || 0, 0);

  try {
    const messages = await ChatMessageModel.find({
      chatId: input.chatId.trim(),
    })
      .sort({ createdAt: 1 }) // ascending order (oldest first)
      .skip(offset)
      .limit(limit)
      .lean<ChatMessage[]>()
      .exec();

    return messages;
  } catch (error: unknown) {
    console.error("Failed to get chat messages:", error);
    throw new Error("Failed to get chat messages");
  }
}

/**
 * Retrieves a single message by its ID
 */
export async function getMessageById(id: string): Promise<ChatMessage | null> {
  await ensureDb();

  if (!id?.trim()) {
    throw new Error("Message ID is required");
  }

  try {
    const message = await ChatMessageModel.findOne({ id: id.trim() })
      .lean<ChatMessage>()
      .exec();

    return message;
  } catch (error: unknown) {
    console.error("Failed to get message by ID:", error);
    throw new Error("Failed to get message by ID");
  }
}

/**
 * Deletes a single message by its ID
 */
export async function deleteMessage(id: string): Promise<boolean> {
  await ensureDb();

  if (!id?.trim()) {
    throw new Error("Message ID is required");
  }

  try {
    const result = await ChatMessageModel.findOneAndDelete({ id: id.trim() });
    return !!result;
  } catch (error: unknown) {
    console.error("Failed to delete message:", error);
    throw new Error("Failed to delete message");
  }
}

/**
 * Gets the latest message for a specific chat
 */
export async function getLatestMessage(
  chatId: string,
): Promise<ChatMessage | null> {
  await ensureDb();

  if (!chatId?.trim()) {
    throw new Error("Chat ID is required");
  }

  try {
    const message = await ChatMessageModel.findOne({ chatId: chatId.trim() })
      .sort({ createdAt: -1 }) // Most recent first
      .lean<ChatMessage>()
      .exec();

    return message;
  } catch (error: unknown) {
    console.error("Failed to get latest message:", error);
    throw new Error("Failed to get latest message");
  }
}

/**
 * Gets all messages with media images from assistant messages for a user
 */
export async function getChatMessagesWithMedia(userId: string): Promise<
  Array<{
    id: string;
    chatId: string;
    messageId: string;
    imageUrl: string;
    createdAt: Date;
    chatTitle?: string;
  }>
> {
  await ensureDb();

  if (!userId?.trim()) {
    throw new Error("User ID is required");
  }

  try {
    // First get all chats for the user
    const { getChatsByUserId } = await import("./chat");
    const chats = await getChatsByUserId(userId);
    const chatIds = chats.map((chat) => chat.id);

    if (chatIds.length === 0) {
      return [];
    }

    // Get all assistant messages that contain image parts
    const messages = await ChatMessageModel.find({
      chatId: { $in: chatIds },
      role: "assistant",
      parts: {
        $elemMatch: {
          type: "file",
          mediaType: { $regex: /^image\// },
        },
      },
    })
      .sort({ createdAt: -1 })
      .lean<ChatMessage[]>()
      .exec();

    // Extract image URLs from message parts
    const mediaMessages: Array<{
      id: string;
      chatId: string;
      messageId: string;
      imageUrl: string;
      createdAt: Date;
      chatTitle?: string;
    }> = [];

    for (const message of messages) {
      const chat = chats.find((c) => c.id === message.chatId);

      for (const part of message.parts) {
        if (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "file" &&
          "mediaType" in part &&
          typeof part.mediaType === "string" &&
          part.mediaType.startsWith("image/") &&
          "url" in part &&
          typeof part.url === "string"
        ) {
          mediaMessages.push({
            id: `${message.id}-${part.url}`,
            chatId: message.chatId,
            messageId: message.id,
            imageUrl: part.url,
            createdAt: message.createdAt,
            chatTitle: chat?.title,
          });
        }
      }
    }

    return mediaMessages;
  } catch (error: unknown) {
    console.error("Failed to get chat messages with media:", error);
    throw new Error("Failed to get chat messages with media");
  }
}

/**
 * Creates multiple messages
 */
export async function createMultipleMessages(
  inputs: CreateMultipleMessagesInput,
): Promise<ChatMessage[]> {
  await ensureDb();

  // Input validation
  if (!inputs?.length) {
    throw new Error("At least one message is required");
  }

  // Validate each input message
  for (const input of inputs) {
    if (!input.id?.trim()) {
      throw new Error("Message ID is required for all messages");
    }
    if (!input.chatId?.trim()) {
      throw new Error("Chat ID is required for all messages");
    }
    if (!input.role) {
      throw new Error("Message role is required for all messages");
    }
    if (!Array.isArray(input.parts)) {
      throw new Error("Message parts must be an array for all messages");
    }
  }

  try {
    // Check for existing messages first to avoid unnecessary operations
    const existingMessages = await ChatMessageModel.find({
      id: { $in: inputs.map((m) => m.id.trim()) },
    })
      .lean<ChatMessage[]>()
      .exec();

    const existingIds = new Set(existingMessages.map((m) => m.id));
    const newInputs = inputs.filter(
      (input) => !existingIds.has(input.id.trim()),
    );

    // If all messages already exist, return them
    if (newInputs.length === 0) {
      return existingMessages;
    }

    // Prepare new messages for insertion
    const messagesToInsert = newInputs.map((input) => ({
      id: input.id.trim(),
      chatId: input.chatId.trim(),
      role: input.role,
      parts: input.parts,
      attachments: input.attachments || [],
    }));

    // Insert new messages with ordered: false to continue on duplicates
    await ChatMessageModel.insertMany(messagesToInsert, { ordered: false });

    // Return all messages (existing + newly created)
    return await ChatMessageModel.find({
      id: { $in: inputs.map((m) => m.id.trim()) },
    })
      .lean<ChatMessage[]>()
      .exec();
  } catch (error: unknown) {
    // Handle MongoDB duplicate key error (code 11000)
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    ) {
      // Some messages were created by another request, fetch and return all messages
      return await ChatMessageModel.find({
        id: { $in: inputs.map((m) => m.id.trim()) },
      })
        .lean<ChatMessage[]>()
        .exec();
    }

    console.error("Failed to create multiple messages:", error);
    throw new Error("Failed to create multiple messages");
  }
}
