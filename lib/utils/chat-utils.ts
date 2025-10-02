import type { UIMessage } from "ai";

/**
 * Utility functions for chat operations
 */

/**
 * Extracts text content from a UIMessage
 */
export function extractTextFromMessage(message: UIMessage): string {
  const textParts = message.parts?.filter((part) => part.type === "text") || [];
  return textParts.map((part) => ("text" in part ? part.text : "")).join(" ");
}

/**
 * Extracts file attachments from a UIMessage
 */
export function extractFilesFromMessage(message: UIMessage): Array<{
  type: string;
  url?: string;
  filename?: string;
  mediaType?: string;
}> {
  const fileParts = message.parts?.filter((part) => part.type === "file") || [];
  return fileParts.map((part) => ({
    type: part.type,
    url: "url" in part ? part.url : undefined,
    filename: "filename" in part ? part.filename : undefined,
    mediaType: "mediaType" in part ? part.mediaType : undefined,
  }));
}

/**
 * Generates a chat title from the first user message
 */
export function generateChatTitle(messages: UIMessage[]): string {
  const firstUserMessage = messages.find((m) => m.role === "user");
  if (!firstUserMessage) return "New Chat";

  const text = extractTextFromMessage(firstUserMessage);
  if (!text.trim()) return "New Chat";

  // Take first 50 characters and add ellipsis if longer
  return text.length > 50 ? text.slice(0, 50).trim() + "..." : text.trim();
}

/**
 * Validates if a message has content (text or files)
 */
export function hasMessageContent(message: UIMessage): boolean {
  const hasText = extractTextFromMessage(message).trim().length > 0;
  const hasFiles = extractFilesFromMessage(message).length > 0;
  return hasText || hasFiles;
}

/**
 * Counts tokens in a message (rough estimation)
 */
export function estimateTokenCount(message: UIMessage): number {
  const text = extractTextFromMessage(message);
  // Rough estimation: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Formats a date for display in chat
 */
export function formatChatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

/**
 * Sanitizes chat title for safe display
 */
export function sanitizeChatTitle(title: string): string {
  return title
    .replace(/[<>]/g, "") // Remove potential HTML tags
    .trim()
    .slice(0, 100); // Limit length
}

