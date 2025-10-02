/**
 * Validation utilities for the application
 */

import { Types } from "mongoose";

/**
 * Validates if a string is a valid MongoDB ObjectId
 * @param id - The ID string to validate
 * @returns true if valid ObjectId, false otherwise
 */
export function isValidObjectId(id: string | null | undefined): id is string {
  if (!id || typeof id !== "string") {
    return false;
  }

  return Types.ObjectId.isValid(id) && id.length === 24;
}

/**
 * Validates and sanitizes a chat ID
 * @param chatId - The chat ID to validate
 * @returns The sanitized chat ID or null if invalid
 */
export function validateChatId(chatId: unknown): string | null {
  if (typeof chatId !== "string" || !chatId.trim()) {
    return null;
  }

  const sanitized = chatId.trim();
  return isValidObjectId(sanitized) ? sanitized : null;
}

/**
 * Validates a chat title
 * @param title - The title to validate
 * @returns The sanitized title or null if invalid
 */
export function validateChatTitle(title: unknown): string | null {
  if (typeof title !== "string" || !title.trim()) {
    return null;
  }

  const sanitized = title.trim();

  // Check length constraints
  if (sanitized.length < 1 || sanitized.length > 200) {
    return null;
  }

  return sanitized;
}

/**
 * Converts chat objects to ChatHistoryItem format
 * @param chats - Array of chat objects from database
 * @returns Array of ChatHistoryItem objects
 */
interface ChatData {
  id: string;
  title: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export function convertToHistoryItems(chats: unknown[]): Array<{
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}> {
  if (!Array.isArray(chats)) {
    return [];
  }

  return chats
    .filter((chat): chat is ChatData => {
      return (
        typeof chat === "object" &&
        chat !== null &&
        "id" in chat &&
        "title" in chat &&
        "createdAt" in chat &&
        "updatedAt" in chat &&
        typeof (chat as ChatData).id === "string" &&
        typeof (chat as ChatData).title === "string"
      );
    })
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      createdAt:
        chat.createdAt instanceof Date
          ? chat.createdAt
          : new Date(chat.createdAt),
      updatedAt:
        chat.updatedAt instanceof Date
          ? chat.updatedAt
          : new Date(chat.updatedAt),
    }));
}
