import { describe, expect, test } from "bun:test";
import { createJobsClient, isAbortError } from "../lib/jobs/client";

function hangingFetch() {
  return ((_, init) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("The request was aborted");
        error.name = "AbortError";
        reject(error);
      });
    })) as typeof fetch;
}

describe("jobs client request bounding", () => {
  test("reads time out with a bounded error instead of hanging", async () => {
    const client = createJobsClient({
      readTimeoutMs: 20,
      fetch: hangingFetch(),
    });
    expect(isAbortError(await client.list().catch((error) => error))).toBe(
      false,
    );
    const outcome = await client.list().then(
      () => "resolved",
      (error: Error) => error.message,
    );
    expect(outcome).toBe("jobs_request_timeout");
  });

  test("external aborts reject as AbortError and are distinguishable from failures", async () => {
    const client = createJobsClient({ fetch: hangingFetch() });
    const controller = new AbortController();
    const outcome = client.list(controller.signal).then(
      () => "resolved",
      (error: Error) => error.name,
    );
    controller.abort();
    expect(await outcome).toBe("AbortError");
    expect(isAbortError(new Error("jobs_request_failed"))).toBe(false);
  });

  test("successful responses are parsed into job payloads", async () => {
    const record = {
      id: crypto.randomUUID(),
      state: "cancelled",
      source: { artifactId: "a", version: 1 },
      checkpoint: null,
      actionRevision: "publish-fixture-report-v1",
      proposal: null,
      approvalExpiresAt: null,
      resultArtifactId: null,
      attempts: 1,
      error: null,
    };
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createJobsClient({
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ job: record }), { status: 200 });
      }) as typeof fetch,
    });
    const controller = new AbortController();
    const cancelled = await client.cancel(record.id, controller.signal);
    expect(cancelled.state).toBe("cancelled");
    expect(calls[0]?.url).toBe("/api/jobs");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      action: "cancel",
      id: record.id,
    });
    // The transport signal is released after completion; the caller's signal
    // is never aborted by the client itself.
    expect((calls[0]?.init.signal as AbortSignal).aborted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
  });
});

test("a pre-aborted request never dispatches a cancellation", async () => {
  let calls = 0;
  const client = createJobsClient({
    fetch: (async () => {
      calls += 1;
      return Response.json({ job: {} });
    }) as typeof fetch,
  });
  const controller = new AbortController();
  controller.abort();
  const error = await client
    .cancel(crypto.randomUUID(), controller.signal)
    .catch((error) => error);
  expect(isAbortError(error)).toBe(true);
  expect(calls).toBe(0);
});

test("settled requests remove their external abort listener", async () => {
  const controller = new AbortController();
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  const listeners = new Set<EventListenerOrEventListenerObject>();
  controller.signal.addEventListener = (type, callback, options) => {
    if (type === "abort" && callback) listeners.add(callback);
    add(type, callback, options);
  };
  controller.signal.removeEventListener = (type, callback, options) => {
    if (type === "abort" && callback) listeners.delete(callback);
    remove(type, callback, options);
  };
  const client = createJobsClient({
    fetch: (async () => Response.json({ jobs: [] })) as typeof fetch,
  });
  await client.list(controller.signal);
  expect(listeners.size).toBe(0);
});
