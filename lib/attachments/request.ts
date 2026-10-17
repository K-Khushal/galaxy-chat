import "server-only";
import type { z } from "zod";
import { attachmentConfig } from "@/lib/attachments/config";
import {
  type AttachmentModelCapabilities,
  buildAttachmentContext,
  type ResolvedAttachmentContext,
} from "@/lib/attachments/context";
import type { attachmentPreviewSchema } from "@/lib/attachments/contract";
import type { AttachmentExecutor } from "@/lib/attachments/store";
import { resolveByokModel } from "@/lib/byok/config";
import { CONTEXT_LIMITS } from "@/lib/context/contract";
import { LIMITS, resolveFundingConfig } from "@/lib/credits/config";
import { boundContext, type TextTurn } from "@/lib/credits/service";
import { AppError } from "@/lib/errors";
export async function resolveAttachmentRequest(
  userId: string,
  selection: z.infer<typeof attachmentPreviewSchema>,
  options: {
    expectedDigest?: string;
    includeImageBytes?: boolean;
    temporary?: boolean;
    executor?: AttachmentExecutor;
  } = {},
) {
  if (selection.ids.length) attachmentConfig();
  let images: AttachmentModelCapabilities["images"];
  if (selection.funding === "platform") {
    const config = resolveFundingConfig(process.env);
    if (config.price.model !== selection.model)
      throw new AppError("model_not_funded", 403);
  } else
    images = resolveByokModel(process.env, selection.model, selection.funding)
      .capabilities.images;
  return buildAttachmentContext({
    userId,
    chatId: selection.chatId,
    attachmentIds: selection.ids,
    model: { images },
    maxContextTokens: LIMITS.inputTokens,
    expectedDigest: options.expectedDigest,
    includeImageBytes: options.includeImageBytes,
    temporary: options.temporary,
    executor: options.executor,
  });
}
export function attachmentInstructions(
  instructions: string,
  files: ResolvedAttachmentContext,
) {
  const combined =
    instructions + (files.instructions ? `\n${files.instructions}` : "");
  if (
    new TextEncoder().encode(JSON.stringify(combined)).length >
    CONTEXT_LIMITS.instructionBytes
  )
    throw new AppError("context_too_large", 400);
  return combined;
}
/** Excerpts are user data. Only the fixed untrusted-data guard joins instructions. */
export function attachmentTurns(
  turns: TextTurn[],
  instructions: string,
  files: ResolvedAttachmentContext,
) {
  const selected = turns.map((turn) => ({ ...turn }));
  const last = selected.at(-1);
  if (!last || last.role !== "user") throw new AppError("invalid_request", 400);
  const text = files.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  if (text) last.content += `\n\n${text}`;
  const bounded = boundContext(selected, false, instructions);
  const bytes = () =>
    new TextEncoder().encode(JSON.stringify([instructions, bounded])).length;
  while (bounded.length > 1 && bytes() + files.imageTokens > LIMITS.inputTokens)
    bounded.shift();
  if (bytes() + files.imageTokens > LIMITS.inputTokens)
    throw new AppError("attachment_context_limit", 413);
  return bounded;
}
