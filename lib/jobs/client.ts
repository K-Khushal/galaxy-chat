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
  list: (signal?: AbortSignal) => Promise<JobRecord[]>;
  read: (id: string, signal?: AbortSignal) => Promise<JobRecord>;
  cancel: (id: string, signal?: AbortSignal) => Promise<JobRecord>;
};

const DEFAULT_READ_TIMEOUT_MS = 10_000;

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function abortError() {
  const error = new Error("The request was aborted");
  error.name = "AbortError";
  return error;
}

export function createJobsClient(options?: {
  readTimeoutMs?: number;
  fetch?: typeof fetch;
}) {
  const readTimeoutMs = options?.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const doFetch = options?.fetch ?? fetch.bind(globalThis);

  /** One bounded request: an explicit external abort wins immediately, reads
   * time out after readTimeoutMs, and cancellation runs unbounded but stays
   * abortable. The underlying fetch is always signalled to stop. */
  async function requestJson<T>(
    url: string,
    init: RequestInit,
    external: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const racers: Promise<T>[] = [];
    const work = (async () => {
      const res = await doFetch(url, { ...init, signal: controller.signal });
      if (!res.ok) throw new Error("jobs_request_failed");
      return (await res.json()) as T;
    })();
    racers.push(work);
    if (timeoutMs > 0) {
      racers.push(
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("jobs_request_timeout"));
          }, timeoutMs);
        }),
      );
    }
    if (external) {
      racers.push(
        new Promise<never>((_, reject) => {
          if (external.aborted) {
            reject(abortError());
            return;
          }
          external.addEventListener("abort", () => reject(abortError()), {
            once: true,
          });
        }),
      );
    }
    try {
      return await Promise.race(racers);
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }

  async function jobOf(payload: { job?: JobRecord }): Promise<JobRecord> {
    if (!payload.job) throw new Error("jobs_request_failed");
    return payload.job;
  }

  return {
    list: (signal?: AbortSignal) =>
      requestJson<{ jobs?: JobRecord[] }>(
        "/api/jobs",
        { cache: "no-store" },
        signal,
        readTimeoutMs,
      ).then(async (data) => {
        if (!data.jobs) throw new Error("jobs_request_failed");
        return data.jobs;
      }),
    read: (id: string, signal?: AbortSignal) =>
      requestJson<{ job?: JobRecord }>(
        `/api/jobs?id=${encodeURIComponent(id)}`,
        { cache: "no-store" },
        signal,
        readTimeoutMs,
      ).then(jobOf),
    cancel: (id: string, signal?: AbortSignal) =>
      requestJson<{ job?: JobRecord }>(
        "/api/jobs",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "cancel", id }),
        },
        signal,
        0,
      ).then(jobOf),
  } satisfies JobsClient;
}

export const jobsClient = createJobsClient();
