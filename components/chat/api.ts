import type { ChatMessage, ChatSummary } from "@/lib/chat/store";
export type ChatView = {
  chat: ChatSummary;
  messages: ChatMessage[];
  generation: { messageId: string } | null;
};
export async function api<T>(
  url: string,
  body?: object,
  method = "POST",
): Promise<T> {
  const response = await fetch(
    url,
    body
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { method: "GET" },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? "connection_failed");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
const errors: Record<string, string> = {
  no_credits:
    "Your Credits are used up. Add your OpenRouter key to keep chatting.",
  needs_byok_key: "Add your OpenRouter key to use this model.",
  provider_key_rejected:
    "OpenRouter did not accept this key. Check it and try again.",
  provider_payment_required:
    "Add funds to your OpenRouter account, then try again.",
  payload_too_large: "This Message is too long. Shorten it and try again.",
  rate_limited: "Too many messages. Wait a minute and try again.",
  generation_active:
    "A Reply is already being written. Stop it or wait for it to finish.",
  chat_not_found:
    "This Chat could not be found. Start a new Chat from the sidebar.",
  server_misconfigured:
    "Chat is unavailable right now. Please try again later.",
};
export function errorCode(error: Error) {
  let code = error.message;
  try {
    code = JSON.parse(code).error ?? code;
  } catch {}
  return code;
}
export function needsKey(error: Error) {
  return [
    "no_credits",
    "needs_byok_key",
    "provider_key_rejected",
    "provider_payment_required",
  ].includes(errorCode(error));
}
export function errorCopy(error: Error) {
  return errors[errorCode(error)] ?? "Something went wrong. Please try again.";
}
export function textOf(message: { parts: ChatMessage["parts"] }) {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

export function chatMessage(
  message: { id: string; role: string; parts: ChatMessage["parts"] },
  saved: ChatMessage | undefined,
  parentId: string | null,
  model: string,
): ChatMessage {
  return {
    parentId,
    status: "complete",
    model,
    payment: null,
    usage: null,
    error: null,
    createdAt: "",
    versions: { ids: [message.id], index: 0 },
    ...saved,
    ...message,
    role: message.role === "user" ? "user" : "assistant",
  };
}
