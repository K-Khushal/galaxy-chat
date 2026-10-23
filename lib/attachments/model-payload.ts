import "server-only";
import type { ModelMessage, UserContent } from "ai";
import type {
  AttachmentModelCapabilities,
  ResolvedAttachmentContext,
} from "@/lib/attachments/context";
import { attachmentLimits } from "@/lib/attachments/contract";
import { attachmentHash } from "@/lib/attachments/service";
import { LIMITS } from "@/lib/credits/config";
import { boundContext, type TextTurn } from "@/lib/credits/service";
import { AppError } from "@/lib/errors";
export type AttachmentImagePlan = {
  preview: ResolvedAttachmentContext;
  load: () => Promise<ResolvedAttachmentContext>;
};
export type PromptImageFile = Extract<
  Exclude<UserContent, string>[number],
  { type: "file" }
>;
export function boundImageContext(
  turns: TextTurn[],
  instructions: string,
  plan: AttachmentImagePlan | undefined,
  capabilities: AttachmentModelCapabilities,
) {
  const selected = boundContext(turns, false, instructions);
  if (!plan) return selected;
  const capability = capabilities.images;
  const types = plan.preview.imageMediaTypes;
  if (
    !capability?.verified ||
    !types.length ||
    types.length > attachmentLimits.perMessage ||
    types.some((type) => !capability.mediaTypes.includes(type)) ||
    plan.preview.imageTokens !== types.length * capability.maxTokensPerImage
  )
    throw new AppError("attachment_model_unsupported", 400);
  const bytes = () =>
    new TextEncoder().encode(JSON.stringify([instructions, selected])).length;
  while (
    selected.length > 1 &&
    bytes() + plan.preview.imageTokens > LIMITS.inputTokens
  )
    selected.shift();
  if (bytes() + plan.preview.imageTokens > LIMITS.inputTokens)
    throw new AppError("attachment_context_limit", 413);
  return selected;
}
/** Called while reserved, before the claim transaction. No remote URLs accepted. */
export async function loadImagePayload(plan: AttachmentImagePlan) {
  const loaded = await plan.load();
  if (
    loaded.digest !== plan.preview.digest ||
    loaded.imageTokens !== plan.preview.imageTokens ||
    JSON.stringify(loaded.provenance) !==
      JSON.stringify(plan.preview.provenance) ||
    JSON.stringify(loaded.imageMediaTypes) !==
      JSON.stringify(plan.preview.imageMediaTypes)
  )
    throw new AppError("attachment_context_changed", 409);
  const files = loaded.content.filter((part) => part.type === "file");
  const sources = loaded.provenance.filter((source) => source.kind === "image");
  if (
    files.length !== sources.length ||
    files.length !== loaded.imageMediaTypes.length ||
    files.length > attachmentLimits.perMessage
  )
    throw new AppError("attachment_integrity_failed", 503);
  for (let index = 0; index < files.length; index++) {
    const data = files[index].data;
    if (
      !(data instanceof Uint8Array) ||
      data.length < 1 ||
      data.length > attachmentLimits.fileBytes ||
      files[index].mediaType !== loaded.imageMediaTypes[index] ||
      (await attachmentHash(data)) !== sources[index].sha256
    )
      throw new AppError("attachment_integrity_failed", 503);
  }
  return files;
}
export function imageModelMessages(
  turns: TextTurn[],
  files: PromptImageFile[],
): ModelMessage[] {
  const messages: ModelMessage[] = turns.map((turn) => ({ ...turn }));
  if (files.length) {
    const last = messages.at(-1);
    if (!last || last.role !== "user" || typeof last.content !== "string")
      throw new AppError("invalid_request", 400);
    last.content = [{ type: "text", text: last.content }, ...files];
  }
  return messages;
}
