import { z } from "zod";
import {
  type AttachmentContextView,
  attachmentPreviewSchema,
} from "@/lib/attachments/contract";
export const CONTEXT_LIMITS = {
  memories: 8,
  instructionBytes: 4500,
  inputBytes: 12000,
  inputTokens: 16384,
  outputTokens: 512,
} as const;
export const contextSelectionSchema = z
  .object({
    projectId: z.uuid().nullable().default(null),
    memoryIds: z.array(z.uuid()).max(CONTEXT_LIMITS.memories).default([]),
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type ContextSelection = z.infer<typeof contextSelectionSchema>;
export type ContextView = {
  project: { id: string; name: string; instructions: string } | null;
  memories: { id: string; content: string }[];
  instructions: string;
  digest: string;
  instructionBytes: number;
  limits: typeof CONTEXT_LIMITS;
  attachments?: AttachmentContextView;
};
export type ContextLibrary = {
  memories: { id: string; content: string; projectId: string | null }[];
  projects: { id: string; name: string; instructions: string }[];
  chats: { id: string; title: string; projectId: string | null }[];
};
export const contextMutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("preview"),
      selection: contextSelectionSchema,
      attachments: attachmentPreviewSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("memory.save"),
      id: z.uuid().optional(),
      content: z.string().trim().min(1).max(1000),
      projectId: z.uuid().nullable().default(null),
    })
    .strict(),
  z.object({ action: z.literal("memory.delete"), id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("project.save"),
      id: z.uuid().optional(),
      name: z.string().trim().min(1).max(80),
      instructions: z.string().trim().max(2000),
    })
    .strict(),
  z.object({ action: z.literal("project.delete"), id: z.uuid() }).strict(),
]);
