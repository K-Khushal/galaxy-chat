import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { deepFreeze } from "@/lib/funding/config";
import { digestSchema } from "./operation-contract";

const connection = z.object({ id: z.uuid(), revision: z.uuid() }).strict();
export const adoptionInput = z
  .object({
    id: z.uuid(),
    manifestDigest: digestSchema,
    initializeConnection: connection,
    callConnection: connection,
  })
  .strict();
export const executionInput = z
  .object({
    id: z.uuid(),
    runId: z.uuid(),
    toolCallId: z.string().regex(/^[a-zA-Z0-9:_-]{1,160}$/),
    adoptionId: z.uuid(),
    arguments: z.unknown(),
  })
  .strict();
export const runtimeActionSchema = z
  .object({ frameId: z.uuid(), digest: digestSchema })
  .strict();
export type RuntimeAction = z.infer<typeof runtimeActionSchema>;
export function parseExecution<T>(
  schema: z.ZodType<T>,
  raw: unknown,
): Readonly<T> {
  const r = schema.safeParse(raw);
  if (!r.success) throw new AppError("invalid_mcp_execution", 400);
  return deepFreeze(r.data);
}
