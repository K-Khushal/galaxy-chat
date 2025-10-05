import type { FileUIPart, UIDataTypes, UIMessagePart, UITools } from "ai";
import type { TypeChatMessage, TypeUIMessage } from "../types";

/**
 * Handles chat API errors and returns user-friendly error messages
 * @param error - The error object from the chat API
 * @returns A user-friendly error message
 */
export function getChatErrorMessage(error: Error): string {
  // Handle specific error types based on OpenRouter error patterns
  if (error.message.includes("No endpoints found that support image input")) {
    return "The selected model doesn't support image input. Please try a different model or remove the image.";
  } else if (
    error.message.includes("model is too busy") ||
    error.message.includes("rate limit") ||
    error.message.includes("busy")
  ) {
    return "The model is currently busy. Please try again in a moment.";
  } else if (
    error.message.includes("API key") ||
    error.message.includes("unauthorized")
  ) {
    return "API configuration error. Please contact support.";
  } else if (
    error.message.includes("network") ||
    error.message.includes("fetch") ||
    error.message.includes("timeout")
  ) {
    return "Network error. Please check your connection and try again.";
  } else if (
    error.message.includes("quota") ||
    error.message.includes("limit")
  ) {
    return "Usage limit reached. Please try again later.";
  } else if (
    error.message.includes("invalid") ||
    error.message.includes("malformed")
  ) {
    return "Invalid request. Please check your input and try again.";
  }

  // Default error message
  return "An error occurred while processing your request. Please try again.";
}

export const filterValidFiles = (files: FileUIPart[]) => {
  return files.filter((file) => {
    // Check if file has a valid URL (not a blob URL)
    const hasValidUrl = file.url && !file.url.startsWith("blob:");

    // Check upload status if available
    const uploadStatus = (file as { uploadStatus?: string }).uploadStatus;
    const isUploaded = !uploadStatus || uploadStatus === "completed";

    return hasValidUrl && isUploaded;
  });
};

export function convertToUIMessages(
  messages: TypeChatMessage[],
): TypeUIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts as UIMessagePart<UIDataTypes, UITools>[],
  }));
}

export async function fetchWithErrorHandling(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      const { code, cause } = await response.json();
      throw new Error(code, cause);
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("offline:chat");
    }
    throw error;
  }
}
