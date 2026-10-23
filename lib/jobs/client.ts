import type { JobState } from "./contract";

/** Serialized JobView as delivered by /api/jobs (dates become ISO strings). */
export type JobRecord = {
  id: string;
  state: JobState;
  source: { artifactId: string; version: number };
  checkpoint: string | null;
  actionRevision: string;
  proposal: string | null;
  approvalExpiresAt: string | null;
  resultArtifactId: string | null;
  attempts: number;
  error: string | null;
};

export type JobsClient = {
  list: () => Promise<JobRecord[]>;
  read: (id: string) => Promise<JobRecord>;
  cancel: (id: string) => Promise<JobRecord>;
};

async function jobResponse(res: Response): Promise<JobRecord> {
  if (!res.ok) throw new Error("jobs_request_failed");
  const data = (await res.json()) as { job?: JobRecord };
  if (!data.job) throw new Error("jobs_request_failed");
  return data.job;
}

export const jobsClient: JobsClient = {
  list: async () => {
    const res = await fetch("/api/jobs", { cache: "no-store" });
    if (!res.ok) throw new Error("jobs_request_failed");
    const data = (await res.json()) as { jobs?: JobRecord[] };
    if (!data.jobs) throw new Error("jobs_request_failed");
    return data.jobs;
  },
  read: async (id) =>
    jobResponse(
      await fetch(`/api/jobs?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      }),
    ),
  cancel: async (id) =>
    jobResponse(
      await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel", id }),
      }),
    ),
};
