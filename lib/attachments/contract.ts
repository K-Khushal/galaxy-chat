import { z } from "zod";
export const attachmentLimits = {
  fileBytes: 2 * 1024 * 1024,
  textBytes: 128 * 1024,
  extractedCharacters: 24_000,
  pages: 12,
  imagePixels: 4_000_000,
  perMessage: 3,
  userFiles: 20,
  uploadLeaseMs: 5 * 60_000,
  signedSeconds: 60,
  globalObjects: 1000,
  globalProcessing: 2,
  ownerProcessing: 1,
} as const;
export type AttachmentKind = "text" | "markdown" | "pdf" | "image";
export type AttachmentView = {
  id: string;
  chatId: string;
  name: string;
  mediaType: string;
  bytes: number;
  kind: AttachmentKind;
  state: "processing" | "ready" | "deleting";
  pages: number | null;
  extractedCharacters: number;
  createdAt: string;
};
export const attachmentAccept = ".txt,.md,.markdown,.pdf,.png,.jpg,.jpeg,.webp";

export const attachmentSelectionSchema = z
  .object({
    ids: z.array(z.uuid()).max(attachmentLimits.perMessage),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const attachmentPreviewSchema = z
  .object({
    chatId: z.uuid(),
    ids: z.array(z.uuid()).max(attachmentLimits.perMessage),
    funding: z.enum(["platform", "openrouter", "gateway"]),
    model: z.string().min(1).max(100),
  })
  .strict();
export type AttachmentSource = {
  id: string;
  name: string;
  pages: number | null;
  kind: string;
  sha256: string;
};
export type AttachmentContextView = {
  digest: string;
  estimatedTokens: number;
  imageTokens: number;
  provenance: AttachmentSource[];
  excerpts: Array<{ id: string; text: string }>;
};
export type AttachmentSelection = z.infer<typeof attachmentSelectionSchema>;
