import { z } from "zod";
import { selectedRevision, TOOL_LIMITS } from "@/lib/tools/contract";

export const JOB_ACTION_REVISION = "publish-fixture-report-v1" as const;

export const JOB_LIMITS = {
  activePerOwner: 1,
  activeGlobal: 2,
  queuedPerOwner: 10,
  attempts: 5,
  wallMs: 10 * 60_000,
  leaseMs: TOOL_LIMITS.timeoutMs,
  approvalMs: 5 * 60_000,
  recordsPerOwner: TOOL_LIMITS.records,
  recordsGlobal: TOOL_LIMITS.globalRecords,
} as const;
export const jobRequest = z
  .object({
    id: z.uuid(),
    source: selectedRevision,
    adapter: z.literal("local-fixture-v1"),
  })
  .strict();
export const jobApproval = z
  .object({
    id: z.uuid(),
    checkpoint: z.string().regex(/^[a-f0-9]{64}$/),
    actionRevision: z.literal(JOB_ACTION_REVISION),
  })
  .strict();
export type JobState =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "cancelled"
  | "failed";
export type JobLease = {
  id: string;
  ownerId: string;
  fence: number;
  attempt: number;
  checkpoint: number;
};
export type JobView = {
  id: string;
  state: JobState;
  source: { artifactId: string; version: number };
  checkpoint: string | null;
  actionRevision: typeof JOB_ACTION_REVISION;
  proposal: string | null;
  approvalExpiresAt: Date | null;
  resultArtifactId: string | null;
  attempts: number;
  error: string | null;
};
