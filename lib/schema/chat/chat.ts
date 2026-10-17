import { z } from "zod";
import { attachmentSelectionSchema } from "@/lib/attachments/contract";
import { contextSelectionSchema } from "@/lib/context/contract";

const textPartSchema = z.object({
  type: z.enum(["text"]),
  text: z.string().min(1).max(2000),
});

const filePartSchema = z.object({
  type: z.enum(["file"]),
  mediaType: z.enum(["image/jpeg", "image/png"]),
  name: z.string().min(1).max(100),
  url: z.url(),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

export const postRequestBodySchema = z
  .object({
    id: z.uuid(),
    requestId: z.uuid(),
    branchId: z.uuid(),
    action: z.enum(["send", "edit", "regenerate", "retry"]).default("send"),
    anchorId: z.uuid().optional(),
    context: contextSelectionSchema.optional(),
    attachments: attachmentSelectionSchema.optional(),
    temporary: z.boolean().optional(),
    transientMessages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1).max(32000),
          })
          .strict(),
      )
      .max(11)
      .optional(),
    message: z
      .object({
        id: z.uuid(),
        role: z.enum(["user"]),
        parts: z.array(partSchema).min(1).max(8),
      })
      .strict(),
    funding: z.enum(["platform", "openrouter", "gateway"]),
    model: z.string().min(1).max(100),
    webSearch: z.boolean(),
    visibility: z.enum(["public", "private"]).default("private"),
  })
  .strict();

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
