import type { LanguageModelUsage, UIMessage } from "ai";
import type { AppUsage } from "../ai/usage";

export type TypeUserProfile = {
  userId: string;
  name?: string;
  email?: string;
  imageUrl?: string;
};

export type ChatMessageRole = "system" | "user" | "assistant";

export type ChatVisibility = "public" | "private";

export type Chat = {
  id: string;
  title: string;
  userId: string;
  visibility: ChatVisibility;
  lastContext: AppUsage | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TypeChatMessage = {
  id: string;
  chatId: string; // Ref to Chat document
  role: ChatMessageRole;
  parts: unknown[]; // Array of UIMessagePart JSON objects from AI SDK
  attachments: unknown[]; // Arbitrary attachment metadata
  createdAt: Date;
  updatedAt: Date;
};
export type UsageMetadata = {
  usage: LanguageModelUsage;
};

export type TypeUIMessage = UIMessage<UsageMetadata>;

export type ChatHistory = {
  chats: Chat[];
  hasMore: boolean;
};
