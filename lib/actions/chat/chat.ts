import type { AppUsage } from "@/lib/ai/usage";
import { ensureDb } from "@/lib/database/db";
import type { IChat } from "@/lib/database/models/chat";
import { ChatModel } from "@/lib/database/models/chat";
import { ChatMessageModel } from "@/lib/database/models/chat-message";
import type { ChatVisibility } from "@/lib/types";

export type Chat = IChat;

// Input validation types
export type CreateChatInput = {
  id: string;
  userId: string;
  title: string;
  visibility: ChatVisibility;
};

export type UpdateChatInput = {
  id: string;
  title?: string;
  visibility?: ChatVisibility;
  lastContext?: unknown;
};

export type GetChatsInput = {
  userId: string;
  limit?: number;
  startingAfter?: string;
  endingBefore?: string;
};

export type GetChatsResult = {
  chats: Chat[];
  hasMore: boolean;
};

/**
 * Creates a new chat with the provided details
 */
export async function createChat(input: CreateChatInput): Promise<Chat> {
  await ensureDb();

  // Input validation
  if (!input.id?.trim()) {
    throw new Error("Chat ID is required");
  }
  if (!input.userId?.trim()) {
    throw new Error("User ID is required");
  }
  if (!input.title?.trim()) {
    throw new Error("Chat title is required");
  }

  try {
    // Check if chat already exists
    const existingChat = await ChatModel.findOne({ id: input.id })
      .lean<Chat>()
      .exec();

    if (existingChat) {
      return existingChat;
    }

    const chat = new ChatModel({
      id: input.id.trim(),
      userId: input.userId.trim(),
      title: input.title.trim(),
      visibility: input.visibility,
    });

    const result = await chat.save();
    return result.toObject();
  } catch (error: unknown) {
    // Handle MongoDB duplicate key error (code 11000)
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    ) {
      // Chat was created by another request, fetch and return the existing chat
      const existingChat = await ChatModel.findOne({ id: input.id })
        .lean<Chat>()
        .exec();

      if (existingChat) {
        return existingChat;
      }
    }

    console.error("Failed to create chat:", error);
    throw new Error("Failed to create chat");
  }
}

/**
 * Updates an existing chat
 */
export async function updateChat(input: UpdateChatInput): Promise<Chat> {
  await ensureDb();

  if (!input.id?.trim()) {
    throw new Error("Chat ID is required");
  }

  try {
    const updateData: Partial<UpdateChatInput> = {};

    if (input.title !== undefined) {
      updateData.title = input.title.trim();
    }
    if (input.visibility !== undefined) {
      updateData.visibility = input.visibility;
    }

    const result = await ChatModel.findOneAndUpdate(
      { id: input.id },
      {
        $set: updateData,
        ...(input.lastContext !== undefined && {
          lastContext: input.lastContext,
        }),
      },
      { new: true, returnDocument: "after" },
    )
      .lean<Chat>()
      .exec();

    if (!result) {
      throw new Error("Chat not found");
    }

    return result;
  } catch (error: unknown) {
    console.error("Failed to update chat:", error);
    throw new Error("Failed to update chat");
  }
}

/**
 * Retrieves a chat by its ID
 */
export async function getChat(id: string): Promise<Chat | null> {
  await ensureDb();

  if (!id?.trim()) {
    throw new Error("Chat ID is required");
  }

  try {
    const chat = await ChatModel.findOne({ id: id.trim() }).lean<Chat>().exec();

    return chat;
  } catch (error: unknown) {
    console.error("Failed to get chat:", error);
    throw new Error("Failed to get chat");
  }
}

/**
 * Retrieves all chats for a user with cursor-based pagination
 */
export async function getUserChats(
  input: GetChatsInput,
): Promise<GetChatsResult> {
  await ensureDb();

  if (!input.userId?.trim()) {
    throw new Error("User ID is required");
  }

  const limit = Math.min(input.limit || 50, 100); // Cap at 100
  const extendedLimit = limit + 1; // Fetch one extra to determine hasMore

  try {
    let query = ChatModel.find({ userId: input.userId.trim() })
      .sort({ createdAt: -1 }) // Most recent first
      .limit(extendedLimit)
      .lean<Chat[]>();

    // Handle cursor-based pagination
    if (input.startingAfter) {
      // Get the chat to start after
      const startingChat = await ChatModel.findOne({
        id: input.startingAfter,
        userId: input.userId.trim(),
      })
        .lean<Chat>()
        .exec();

      if (!startingChat) {
        throw new Error(`Chat with id ${input.startingAfter} not found`);
      }

      // Find chats created before the starting chat
      query = ChatModel.find({
        userId: input.userId.trim(),
        createdAt: { $lt: startingChat.createdAt },
      })
        .sort({ createdAt: -1 })
        .limit(extendedLimit)
        .lean<Chat[]>();
    } else if (input.endingBefore) {
      // Get the chat to end before
      const endingChat = await ChatModel.findOne({
        id: input.endingBefore,
        userId: input.userId.trim(),
      })
        .lean<Chat>()
        .exec();

      if (!endingChat) {
        throw new Error(`Chat with id ${input.endingBefore} not found`);
      }

      // Find chats created after the ending chat
      query = ChatModel.find({
        userId: input.userId.trim(),
        createdAt: { $gt: endingChat.createdAt },
      })
        .sort({ createdAt: -1 })
        .limit(extendedLimit)
        .lean<Chat[]>();
    }

    const chats = await query.exec();
    const hasMore = chats.length > limit;

    return {
      chats: hasMore ? chats.slice(0, limit) : chats,
      hasMore,
    };
  } catch (error: unknown) {
    console.error("Failed to get user chats:", error);
    throw new Error("Failed to get user chats");
  }
}

/**
 * Retrieves all chats for a user (simple version without pagination)
 */
export async function getAllUserChats(userId: string): Promise<Chat[]> {
  await ensureDb();

  if (!userId?.trim()) {
    throw new Error("User ID is required");
  }

  try {
    const chats = await ChatModel.find({ userId: userId.trim() })
      .sort({ createdAt: -1 }) // Most recent first
      .lean<Chat[]>()
      .exec();

    return chats;
  } catch (error: unknown) {
    console.error("Failed to get all user chats:", error);
    throw new Error("Failed to get all user chats");
  }
}

/**
 * Deletes a chat and all its associated messages
 */
export async function deleteChat(id: string): Promise<boolean> {
  await ensureDb();

  if (!id?.trim()) {
    throw new Error("Chat ID is required");
  }

  try {
    // Use transaction to ensure atomicity
    const session = await ChatModel.startSession();

    try {
      await session.withTransaction(async () => {
        // Delete all messages for this chat
        await ChatMessageModel.deleteMany({ chatId: id.trim() }, { session });

        // Delete the chat itself
        const result = await ChatModel.findOneAndDelete(
          { id: id.trim() },
          { session },
        );

        if (!result) {
          throw new Error("Chat not found");
        }
      });

      return true;
    } finally {
      await session.endSession();
    }
  } catch (error: unknown) {
    console.error("Failed to delete chat:", error);
    throw new Error("Failed to delete chat");
  }
}

/**
 * Updates the lastContext field for a specific chat
 */
export async function updateChatLastContext({
  chatId,
  context,
}: {
  chatId: string;
  context: AppUsage;
}): Promise<Chat | null> {
  await ensureDb();

  if (!chatId?.trim()) {
    throw new Error("Chat ID is required");
  }

  if (!context) {
    throw new Error("Context is required");
  }

  try {
    const updatedChat = await ChatModel.findOneAndUpdate(
      { id: chatId.trim() },
      { lastContext: context },
      { new: true, returnDocument: "after" },
    )
      .lean<Chat>()
      .exec();

    return updatedChat;
  } catch (error: unknown) {
    console.error("Failed to update chat last context:", error);
    throw new Error("Failed to update chat last context");
  }
}
