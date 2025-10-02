import { auth } from "@clerk/nextjs/server";
import type { UIMessage } from "ai";
import { Types } from "mongoose";
import { ensureDb } from "../../database/db";
import { ChatModel, type IChat } from "../../database/models/chat";
import {
  ChatMessageModel,
  type IChatMessage,
} from "../../database/models/chat-message";
import { isValidObjectId, validateChatTitle } from "../../utils/validation";
import { getOrCreateUserProfile } from "../auth/user";

export type Chat = IChat & { id: string };
export type ChatMessage = IChatMessage & { id: string };

/**
 * Creates a new chat for the authenticated user
 */
export async function createChat(params: {
  title: string;
  visibility?: "public" | "private";
}): Promise<Chat> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not authenticated");
  }

  // Validate and sanitize title
  const sanitizedTitle = validateChatTitle(params.title);
  if (!sanitizedTitle) {
    throw new Error("Invalid chat title provided");
  }

  await ensureDb();

  try {
    // Ensure user profile exists
    const userProfile = await getOrCreateUserProfile({ userId });

    const chat = new ChatModel({
      title: sanitizedTitle,
      userId: new Types.ObjectId(userProfile._id),
      visibility: params.visibility || "private",
      lastContext: null,
    });

    const savedChat = await chat.save();
    return savedChat.toJSON() as Chat;
  } catch (error) {
    console.error("Error creating chat:", error);
    throw new Error("Failed to create chat");
  }
}

/**
 * Gets a chat by ID, ensuring the user has access to it
 */
export async function getChatById(chatId: string): Promise<Chat | null> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not authenticated");
  }

  // Validate chatId format
  if (!chatId || !isValidObjectId(chatId)) {
    console.warn(`Invalid chat ID format: ${chatId}`);
    return null;
  }

  await ensureDb();

  // Get user profile to match against chat ownership
  const userProfile = await getOrCreateUserProfile({ userId });

  try {
    const chat = await ChatModel.findOne({
      _id: new Types.ObjectId(chatId),
      userId: new Types.ObjectId(userProfile._id),
    }).exec();

    return chat ? (chat.toJSON() as Chat) : null;
  } catch (error) {
    console.error(`Error fetching chat ${chatId}:`, error);
    return null;
  }
}

/**
 * Gets all chats for the authenticated user
 */
export async function getUserChats(): Promise<Chat[]> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not authenticated");
  }

  await ensureDb();

  try {
    // Get user profile to match against chat ownership
    const userProfile = await getOrCreateUserProfile({ userId });

    const chats = await ChatModel.find({
      userId: new Types.ObjectId(userProfile._id),
    })
      .sort({ updatedAt: -1 })
      .exec();

    // Convert to plain objects with proper id field
    return chats.map((chat) => chat.toJSON() as Chat);
  } catch (error) {
    console.error("Error in getUserChats:", error);
    return [];
  }
}

/**
 * Updates a chat's title or other properties
 */
export async function updateChat(
  chatId: string,
  updates: Partial<Pick<IChat, "title" | "visibility" | "lastContext">>,
): Promise<Chat | null> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not authenticated");
  }

  // Validate chatId format
  if (!chatId || !isValidObjectId(chatId)) {
    console.warn(`Invalid chat ID format for update: ${chatId}`);
    return null;
  }

  await ensureDb();

  try {
    // Get user profile to match against chat ownership
    const userProfile = await getOrCreateUserProfile({ userId });

    const updatedChat = await ChatModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(chatId),
        userId: new Types.ObjectId(userProfile._id),
      },
      { $set: updates },
      { new: true },
    ).exec();

    return updatedChat ? (updatedChat.toJSON() as Chat) : null;
  } catch (error) {
    console.error(`Error updating chat ${chatId}:`, error);
    return null;
  }
}

/**
 * Deletes a chat and all its messages
 */
export async function deleteChat(chatId: string): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not authenticated");
  }

  // Validate chatId format
  if (!chatId || !isValidObjectId(chatId)) {
    console.warn(`Invalid chat ID format for deletion: ${chatId}`);
    return false;
  }

  await ensureDb();

  try {
    // Get user profile to match against chat ownership
    const userProfile = await getOrCreateUserProfile({ userId });

    // First verify the chat exists and user owns it
    const chat = await ChatModel.findOne({
      _id: new Types.ObjectId(chatId),
      userId: new Types.ObjectId(userProfile._id),
    }).exec();

    if (!chat) {
      console.warn(`Chat not found or access denied for deletion: ${chatId}`);
      return false;
    }

    // Delete all messages first
    await ChatMessageModel.deleteMany({
      chatId: new Types.ObjectId(chatId),
    }).exec();

    // Delete the chat
    const result = await ChatModel.deleteOne({
      _id: new Types.ObjectId(chatId),
      userId: new Types.ObjectId(userProfile._id),
    }).exec();

    const success = result.deletedCount > 0;
    if (success) {
      console.log(`Successfully deleted chat ${chatId} and its messages`);
    }

    return success;
  } catch (error) {
    console.error(`Error deleting chat ${chatId}:`, error);
    return false;
  }
}

/**
 * Saves a message to a chat
 */
export async function saveChatMessage(params: {
  chatId: string;
  role: "system" | "user" | "assistant";
  parts: unknown[];
  attachments?: unknown[];
}): Promise<ChatMessage> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not authenticated");
  }

  await ensureDb();

  // Verify chat exists and user has access
  const chat = await getChatById(params.chatId);
  if (!chat) {
    throw new Error("Chat not found or access denied");
  }

  const message = new ChatMessageModel({
    chatId: new Types.ObjectId(params.chatId),
    role: params.role,
    parts: params.parts,
    attachments: params.attachments || [],
  });

  const savedMessage = await message.save();

  // Update chat's updatedAt timestamp
  await ChatModel.updateOne(
    { _id: new Types.ObjectId(params.chatId) },
    { $set: { updatedAt: new Date() } },
  ).exec();

  return savedMessage.toJSON() as ChatMessage;
}

/**
 * Gets all messages for a chat
 */
export async function getChatMessages(chatId: string): Promise<ChatMessage[]> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not authenticated");
  }

  // Validate chatId format
  if (!chatId || !isValidObjectId(chatId)) {
    console.warn(`Invalid chat ID format for messages: ${chatId}`);
    return [];
  }

  await ensureDb();

  try {
    // Verify chat exists and user has access
    const chat = await getChatById(chatId);
    if (!chat) {
      console.warn(`Chat not found or access denied for messages: ${chatId}`);
      return [];
    }

    const messages = await ChatMessageModel.find({
      chatId: new Types.ObjectId(chatId),
    })
      .sort({ createdAt: 1 })
      .exec();

    return messages.map((message) => message.toJSON() as ChatMessage);
  } catch (error) {
    console.error(`Error fetching messages for chat ${chatId}:`, error);
    return [];
  }
}

/**
 * Converts AI SDK UIMessage to our database format
 */
export function convertUIMessageToChatMessage(
  message: UIMessage,
): Omit<Parameters<typeof saveChatMessage>[0], "chatId"> {
  return {
    role: message.role as "system" | "user" | "assistant",
    parts: message.parts || [],
    attachments: message.attachments || [],
  };
}

/**
 * Converts our database ChatMessage to AI SDK UIMessage format
 */
export function convertChatMessageToUIMessage(message: ChatMessage): UIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: message.parts as UIMessage["parts"],
    attachments: message.attachments as UIMessage["attachments"],
    createdAt: message.createdAt,
  };
}

/**
 * Saves multiple messages in a batch (useful for conversation history)
 */
export async function saveChatMessages(
  chatId: string,
  messages: UIMessage[],
): Promise<ChatMessage[]> {
  const savedMessages: ChatMessage[] = [];

  for (const message of messages) {
    const messageData = convertUIMessageToChatMessage(message);
    const savedMessage = await saveChatMessage({
      chatId,
      ...messageData,
    });
    savedMessages.push(savedMessage);
  }

  return savedMessages;
}
