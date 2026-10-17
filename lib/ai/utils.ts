import type { FileUIPart, UIDataTypes, UIMessagePart, UITools } from "ai";
import type { TypeChatMessage, TypeUIMessage } from "../types";

/**
 * Handles chat API errors and returns user-friendly error messages
 * @param error - The error object from the chat API
 * @returns A user-friendly error message
 */
export function getChatErrorMessage(error: Error): string {
  const messages: Record<string, string> = {
    request_already_recorded:
      "This request is already saved. Reload saved messages to see its status. A deliberate retry creates a new branch.",
    idempotency_conflict:
      "This request ID was already used. Reload the conversation before sending again.",
    funding_busy:
      "A request is still active or awaiting usage reconciliation. Your current message is saved.",
    chat_busy:
      "A saved request is still active. Wait for it to finish, then reload saved messages.",
    daily_exhausted:
      "Your daily allowance is used. It resets at 00:00 UTC, subject to shared funding.",
    shared_exhausted:
      "The shared allowance is exhausted. Platform generation is paused.",
    provider_failed:
      "The provider could not finish this response. Your prompt is saved. Any uncertain usage remains reserved until reconciled.",
    context_too_large:
      "This prompt exceeds the bounded context limit. Shorten it before sending.",
    funded_capability_denied:
      "This funded model supports basic text only. Files, tools and search are unavailable.",
    branch_limit_reached:
      "This conversation has reached its branch limit. Start a new conversation.",
    conversation_limit_reached:
      "This conversation has reached its message limit. Start a new conversation.",
  };
  if (messages[error.message]) return messages[error.message];
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
      const body = await response.json();
      throw new Error(body.error?.id ?? body.code ?? "chat_failed");
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error(
        "Network error. Please check your connection and try again.",
      );
    }
    throw error;
  }
}

export async function fetchJson(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new Error(code ?? "Unknown error", { cause });
  }

  return response.json();
}

export function formatTitle(input: string): string {
  // 1. Remove any surrounding quotes (single or double)
  const cleaned = input.replace(/^["']|["']$/g, "").trim();

  // 2. Capitalize the first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function getTextMessage(message: TypeUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}
