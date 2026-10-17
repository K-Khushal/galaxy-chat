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
