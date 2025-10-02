import { z } from "zod";

// Chat visibility options
export const chatVisibilitySchema = z.enum(["public", "private"]);

// Chat creation schema
export const createChatSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(200, "Title must be less than 200 characters")
    .trim(),
  visibility: chatVisibilitySchema.optional().default("private"),
});

// Chat update schema
export const updateChatSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(200, "Title must be less than 200 characters")
    .trim()
    .optional(),
  visibility: chatVisibilitySchema.optional(),
  lastContext: z.unknown().optional(),
});

// Chat message role schema
export const chatMessageRoleSchema = z.enum(["system", "user", "assistant"]);

// UI Message Part schemas (based on AI SDK types)
export const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const filePartSchema = z.object({
  type: z.literal("file"),
  filename: z.string().optional(),
  mediaType: z.string().optional(),
  url: z.string().url(),
  size: z.number().optional(),
});

export const sourceUrlPartSchema = z.object({
  type: z.literal("source-url"),
  url: z.string().url(),
  title: z.string().optional(),
});

export const reasoningPartSchema = z.object({
  type: z.literal("reasoning"),
  text: z.string(),
});

export const messagePartSchema = z.discriminatedUnion("type", [
  textPartSchema,
  filePartSchema,
  sourceUrlPartSchema,
  reasoningPartSchema,
]);

// Chat message schema
export const chatMessageSchema = z.object({
  role: chatMessageRoleSchema,
  parts: z.array(messagePartSchema).default([]),
  attachments: z.array(z.unknown()).default([]),
});

// UI Message schema (for AI SDK compatibility) - more flexible
export const uiMessageSchema = z.object({
  id: z.string(),
  role: chatMessageRoleSchema,
  parts: z.array(z.unknown()).default([]), // More flexible for AI SDK compatibility
  attachments: z.array(z.unknown()).default([]),
  createdAt: z.date().optional(),
});

// Chat API request schemas
export const chatApiRequestSchema = z.object({
  messages: z.array(z.unknown()), // Accept any message format from AI SDK
  model: z.string().min(1, "Model is required"),
  webSearch: z.boolean().default(false),
  chatId: z.string().optional(), // For existing chats
  chatTitle: z.string().optional(), // For new chats
});

// Export types
export type ChatVisibility = z.infer<typeof chatVisibilitySchema>;
export type CreateChatInput = z.infer<typeof createChatSchema>;
export type UpdateChatInput = z.infer<typeof updateChatSchema>;
export type ChatMessageRole = z.infer<typeof chatMessageRoleSchema>;
export type MessagePart = z.infer<typeof messagePartSchema>;
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
export type UIMessageInput = z.infer<typeof uiMessageSchema>;
export type ChatApiRequest = z.infer<typeof chatApiRequestSchema>;
