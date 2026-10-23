import "server-only";
import { AppError } from "@/lib/errors";
import type { JobStore } from "./store";

/** No deployed queue binding exists yet. This adapter is deliberately unusable in
 * production; it is a deterministic offline delivery harness, not hosting proof.
 */
export function localFixtureWorker(store: JobStore) {
  if (process.env.NODE_ENV !== "test")
    throw new AppError("job_worker_disabled", 503);
  return {
    async deliver(jobId: string) {
      if (process.env.NODE_ENV !== "test")
        throw new AppError("job_worker_disabled", 503);
      const lease = await store.claim(jobId);
      if (lease) await store.checkpoint(lease);
    },
    async recover() {
      if (process.env.NODE_ENV !== "test")
        throw new AppError("job_worker_disabled", 503);
      for (const id of await store.pendingDeliveryIds()) {
        const lease = await store.claim(id);
        if (lease) await store.checkpoint(lease);
      }
    },
  };
}
