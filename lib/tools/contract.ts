import { z } from "zod";
import { type SearchRunState, searchSelection } from "@/lib/search/contract";
export const TOOL_LIMITS = {
  steps: 3,
  calls: 4,
  timeoutMs: 20_000,
  resultBytes: 4096,
  records: 200,
  globalRecords: 2000,
} as const;
export const selectedRevision = z
  .object({
    artifactId: z.string().min(1).max(200),
    version: z.number().int().min(1).max(40),
  })
  .strict();
export const toolRunRequest = z
  .object({
    id: z.uuid(),
    prompt: z.string().trim().min(1).max(8000),
    funding: z.enum(["openrouter", "gateway"]),
    model: z.string().min(1).max(100),
    estimateMicrodollars: z.number().int().positive().max(2_000_000_000),
    ceilingMicrodollars: z.number().int().positive().max(2_000_000_000),
    providerBudgetAcknowledged: z.literal(true),
    revisions: z.array(selectedRevision).max(4),
    search: searchSelection.optional(),
  })
  .strict();
export type ToolRunRequest = z.infer<typeof toolRunRequest>;
export type SelectedRevision = z.infer<typeof selectedRevision>;
export type ToolState =
  | "queued"
  | "running"
  | "completed"
  | "denied"
  | "failed";
export type ToolEvent = {
  id: string;
  name: string;
  state: ToolState;
  output?: string;
};
export type ToolRunView = {
  id: string;
  state: string;
  answer: string;
  events: ToolEvent[];
  search?: SearchRunState;
};
export const arithmeticSchema = z
  .object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    left: z.number().finite().min(-1e12).max(1e12),
    right: z.number().finite().min(-1e12).max(1e12),
  })
  .strict();
export const revisionSchema = selectedRevision
  .extend({
    offset: z.number().int().min(0).max(131072).default(0),
    length: z.number().int().min(1).max(2000).default(2000),
  })
  .strict();
export const TOOL_DISCLOSURE =
  "Your model provider bills your model key. Set provider spending limits before running. Model and optional search funding are separate. Estimates and application ceilings cannot guarantee provider bills. Tool results are untrusted.";

export function microdollarsFromUSD(value: string): number | undefined {
  const match = /^(0|[1-9]\d{0,3})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return;
  const amount =
    Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(6, "0"));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 2_000_000_000
    ? amount
    : undefined;
}
