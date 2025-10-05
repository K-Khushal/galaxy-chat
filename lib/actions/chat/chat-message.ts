import { ensureDb } from "@/lib/database/db";
import {
  ChatMessageModel,
  type ChatMessageRole,
  type IChatMessage,
} from "@/lib/database/models/chat-message";

export type ChatMessage = IChatMessage;

// Input validation types
export type CreateMessageInput = {
  id: string;
  chatId: string;
  role: ChatMessageRole;
  parts: unknown[];
  attachments?: unknown[];
};

export type CreateMessagesInput = {
  messages: CreateMessageInput[];
};

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
  input: CreateMessageInput,
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
    const updateData: Partial<CreateMessageInput> = {};

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
