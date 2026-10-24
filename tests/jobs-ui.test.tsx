import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, type ReactNode, useLayoutEffect } from "react";
import type { JobRecord, JobsClient } from "../lib/jobs/client";

mock.module("server-only", () => ({}));
mock.module("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));
// Radix picks a no-op layout effect when no document exists at its import
// time, which happens in earlier test files here but never in a browser.
mock.module("@radix-ui/react-use-layout-effect", () => ({
  useLayoutEffect,
}));

// Radix portal components capture globalThis.document at import time, so the
// happy-dom environment is installed before the component tree is imported.
const window = new Window();
const globals = {
  window,
  document: window.document,
  Event: window.Event,
  KeyboardEvent: window.KeyboardEvent,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  getComputedStyle: window.getComputedStyle,
  requestAnimationFrame: window.requestAnimationFrame,
  // Radix layers dispatch CustomEvent instances; happy-dom's dispatchEvent
  // rejects events that are not instances of its own Event class.
  CustomEvent: window.CustomEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
};
const savedGlobals = Object.entries(globals).map(([name, value]) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
  return { name, descriptor };
});

const { JobsWorkbench } = await import("../components/jobs/jobs-workbench");
const { JOB_LIMITS } = await import("../lib/jobs/contract");

afterAll(async () => {
  for (const { name, descriptor } of savedGlobals.reverse()) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  await window.happyDOM.close();
});

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: crypto.randomUUID(),
    state: "queued",
    source: {
      artifactId: "10000000-0000-4000-8000-00000000ba5e",
      version: 1,
    },
    checkpoint: null,
    actionRevision: "publish-fixture-report-v1",
    proposal: null,
    approvalExpiresAt: null,
    resultArtifactId: null,
    attempts: 0,
    error: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function dom() {
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return {
    container,
    render: async (node: ReactNode) => {
      await act(async () => root.render(node));
    },
    click: async (node: Element) => {
      await act(async () => (node as HTMLElement).click());
    },
    settle: async (ms: number) => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
      });
    },
    text: () => document.body.textContent ?? "",
    queryButton: (label: string) =>
      Array.from(document.body.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === label,
      ),
    queryInDialog: (label: string) =>
      Array.from(
        document.body.querySelectorAll('[role="alertdialog"] button'),
      ).find((button) => button.textContent?.trim() === label),
    activeElement: () =>
      (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? "",
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

type TrackedClient = {
  listCalls: number;
  listSignals: AbortSignal[];
  readSignals: AbortSignal[];
  cancelSignals: AbortSignal[];
  cancelIds: string[];
  readIds: string[];
  client: JobsClient;
};

/** Client whose list/read/cancel handlers come from a mutable behavior map,
 * so tests can reorder promise resolution across cancel boundaries. */
function fakeClient(behavior: {
  list?: (signal?: AbortSignal) => Promise<JobRecord[]>;
  read?: (id: string, signal?: AbortSignal) => Promise<JobRecord>;
  cancel?: (id: string, signal?: AbortSignal) => Promise<JobRecord>;
}): TrackedClient {
  const fixture: TrackedClient = {
    listCalls: 0,
    listSignals: [],
    readSignals: [],
    cancelSignals: [],
    cancelIds: [],
    readIds: [],
    client: {
      list: async (signal?: AbortSignal) => {
        fixture.listCalls += 1;
        fixture.listSignals.push(signal ?? new AbortController().signal);
        return behavior.list
          ? behavior.list(signal)
          : Promise.reject(new Error("list_unconfigured"));
      },
      read: async (id: string, signal?: AbortSignal) => {
        fixture.readIds.push(id);
        fixture.readSignals.push(signal ?? new AbortController().signal);
        return behavior.read
          ? behavior.read(id, signal)
          : Promise.reject(new Error("read_unconfigured"));
      },
      cancel: async (id: string, signal?: AbortSignal) => {
        fixture.cancelIds.push(id);
        fixture.cancelSignals.push(signal ?? new AbortController().signal);
        return behavior.cancel
          ? behavior.cancel(id, signal)
          : Promise.reject(new Error("cancel_unconfigured"));
      },
    },
  };
  return fixture;
}

test("jobs page shows loading, empty, error and retry states", async () => {
  const ui = await dom();
  try {
    const pending = deferred<JobRecord[]>();
    const loading = fakeClient({ list: () => pending.promise });
    await ui.render(<JobsWorkbench client={loading.client} pollMs={60_000} />);
    expect(ui.text()).toContain("Loading durable jobs");
    pending.resolve([]);
    await ui.settle(10);
    expect(ui.text()).toContain("No durable jobs");

    const failing = fakeClient({
      list: async () => {
        throw new Error("jobs_request_failed");
      },
    });
    await ui.render(<JobsWorkbench client={failing.client} pollMs={60_000} />);
    expect(ui.text()).toContain("could not be loaded");
    expect(ui.queryButton("Try again")).toBeTruthy();

    const recovered = fakeClient({ list: async () => [job()] });
    await ui.render(
      <JobsWorkbench client={recovered.client} pollMs={60_000} />,
    );
    await ui.settle(10);
    expect(ui.text()).toContain("Queued");
  } finally {
    await ui.close();
  }
});

test("jobs page renders all six states with attempts and honest limits", async () => {
  const ui = await dom();
  try {
    const waiting = job({
      state: "awaiting_approval",
      attempts: 1,
      checkpoint: "a".repeat(64),
      proposal:
        "# Proposed local fixture report\nDeterministic local fixture; no LLM or external provider was used.",
      approvalExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    const failed = job({
      state: "failed",
      attempts: JOB_LIMITS.attempts,
      error: "job_approval_expired",
    });
    const sample = [
      job({ attempts: 2 }),
      job({ state: "running" }),
      waiting,
      job({
        state: "completed",
        resultArtifactId: "11000000-0000-4000-8000-00000000ba5e",
      }),
      job({ state: "cancelled" }),
      failed,
    ];
    const fixture = fakeClient({ list: async () => sample });
    await ui.render(<JobsWorkbench client={fixture.client} pollMs={60_000} />);
    for (const label of [
      "Queued",
      "Running",
      "Awaiting approval",
      "Completed",
      "Cancelled",
      "Failed",
    ])
      expect(ui.text()).toContain(label);
    expect(ui.text()).toContain(`Attempt 2 of ${JOB_LIMITS.attempts}`);
    expect(ui.text()).toContain("production worker delivery is not configured");
    expect(ui.text()).toContain(
      "approval cannot be given here: production worker delivery is not configured",
    );
    expect(ui.text()).toContain(
      "The approval window expired before the job continued.",
    );
    // No execution controls exist anywhere on the page.
    for (const forbidden of ["Approve", "Start", "Create", "Run"])
      expect(ui.queryButton(forbidden)).toBeFalsy();
  } finally {
    await ui.close();
  }
});

test("source artifact identity is plain text with no misleading revision download", async () => {
  const ui = await dom();
  try {
    const sample = job();
    const fixture = fakeClient({ list: async () => [sample] });
    await ui.render(<JobsWorkbench client={fixture.client} pollMs={60_000} />);
    // Collapsed rows show the exact source identity without a link.
    expect(ui.text()).toContain(`Source revision ${sample.source.version} of`);
    expect(ui.text()).toContain(sample.source.artifactId);
    const sourceLinks = Array.from(document.body.querySelectorAll("a")).filter(
      (anchor) =>
        (anchor.getAttribute("href") ?? "").includes(sample.source.artifactId),
    );
    expect(sourceLinks).toHaveLength(0);
    const details = ui.queryButton("Details");
    if (!details) throw new Error("missing_details_button");
    await ui.click(details);
    expect(ui.text()).toContain(
      `${sample.source.artifactId} · version ${sample.source.version}`,
    );
    const detailsSourceLinks = Array.from(
      document.body.querySelectorAll("a"),
    ).filter((anchor) =>
      (anchor.getAttribute("href") ?? "").includes(sample.source.artifactId),
    );
    expect(detailsSourceLinks).toHaveLength(0);
  } finally {
    await ui.close();
  }
});

test("details expand reads authoritative state and renders proposal as plain text with result link", async () => {
  const ui = await dom();
  try {
    const waiting = job({
      state: "awaiting_approval",
      attempts: 1,
      checkpoint: "a".repeat(64),
      proposal: "# Proposed local fixture report\nDeterministic.",
      approvalExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    const completed = job({
      state: "completed",
      attempts: 2,
      checkpoint: "b".repeat(64),
      resultArtifactId: "11000000-0000-4000-8000-00000000ba5e",
    });
    const fixture = fakeClient({
      list: async () => [waiting, completed],
      read: async (id) => (id === completed.id ? completed : waiting),
    });
    await ui.render(<JobsWorkbench client={fixture.client} pollMs={60_000} />);
    // Expand the waiting job first: its proposal, digest and expiry show.
    const waitingButton = ui.queryButton("Details");
    if (!waitingButton) throw new Error("missing_details_button");
    await ui.click(waitingButton);
    expect(fixture.readIds).toContain(waiting.id);
    const text = ui.text();
    expect(text).toContain("publish-fixture-report-v1");
    expect(text).toContain("Proposed local fixture report");
    expect(text).toContain("Deterministic.");
    expect(text).toContain("Approval expiry");
    // Then the completed job: its details show the result download link.
    const completedButton = ui.queryButton("Details");
    if (!completedButton) throw new Error("missing_details_button");
    await ui.click(completedButton);
    const resultLink = Array.from(document.body.querySelectorAll("a")).find(
      (anchor) =>
        anchor
          .getAttribute("href")
          ?.includes("11000000-0000-4000-8000-00000000ba5e"),
    );
    expect(resultLink).toBeTruthy();
    // Proposals render as text, never raw HTML.
    expect(document.body.querySelector("script")).toBeNull();
  } finally {
    await ui.close();
  }
});

test("cancellation requires confirmation, awaits an authoritative list, and reconciles", async () => {
  const ui = await dom();
  try {
    const active = job({ state: "queued" });
    const cancelled = { ...active, state: "cancelled" as const };
    // Storage reflects the cancellation once it lands; later list reads
    // return the cancelled record.
    const fixture = fakeClient({
      list: async () => (fixture.cancelIds.length > 0 ? [cancelled] : [active]),
      cancel: async (id) => {
        expect(id).toBe(active.id);
        return cancelled;
      },
    });
    await ui.render(<JobsWorkbench client={fixture.client} pollMs={60_000} />);
    expect(fixture.listCalls).toBe(1);
    const cancelButton = ui.queryButton("Cancel");
    if (!cancelButton) throw new Error("missing_cancel_button");
    await ui.click(cancelButton);
    expect(fixture.cancelIds).toHaveLength(0);
    expect(ui.text()).toContain("Cancel this durable job?");
    expect(ui.text()).toContain(
      "does not guarantee that work already in progress has terminated",
    );
    expect(ui.text()).toContain("does not issue any refund");
    const confirm = ui.queryButton("Cancel job");
    if (!confirm) throw new Error("missing_confirm_button");
    await ui.click(confirm);
    expect(fixture.cancelIds).toEqual([active.id]);
    // Storage is authoritative: an additional awaited list request runs.
    expect(fixture.listCalls).toBe(2);
    expect(ui.text()).toContain("Cancelled");
    expect(ui.text()).not.toContain("Cancel this durable job?");
  } finally {
    await ui.close();
  }
});

test("cancellation failure is announced inside the dialog and can be retried", async () => {
  const ui = await dom();
  try {
    const active = job({ state: "queued" });
    const cancelled = { ...active, state: "cancelled" as const };
    let fail = true;
    const fixture = fakeClient({
      list: async () => (fixture.cancelIds.length > 0 ? [cancelled] : [active]),
      cancel: async () => {
        if (fail) throw new Error("jobs_request_failed");
        return cancelled;
      },
    });
    await ui.render(<JobsWorkbench client={fixture.client} pollMs={60_000} />);
    const cancelButton = ui.queryButton("Cancel");
    if (!cancelButton) throw new Error("missing_cancel_button");
    await ui.click(cancelButton);
    const confirm = ui.queryButton("Cancel job");
    if (!confirm) throw new Error("missing_confirm_button");
    await ui.click(confirm);
    expect(fixture.cancelIds).toHaveLength(1);
    // The dialog stays open with the error and controls inside its subtree.
    const dialog = document.body.querySelector('[role="alertdialog"]');
    if (!dialog) throw new Error("dialog_closed");
    expect(dialog.textContent).toContain("did not complete");
    const announced = dialog.querySelector('[role="alert"]');
    expect(announced?.textContent).toContain("did not complete");
    expect(ui.queryInDialog("Keep job")).toBeTruthy();
    expect(ui.queryInDialog("Cancel job")).toBeTruthy();
    // Focus is preserved inside the dialog for a keyboard retry.
    const retry = ui.queryInDialog("Cancel job");
    if (!retry) throw new Error("missing_retry");
    fail = false;
    await ui.click(retry);
    expect(fixture.cancelIds).toHaveLength(2);
    await ui.settle(20);
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(ui.text()).toContain("Cancelled");
  } finally {
    await ui.close();
  }
});

test("a detail read that resolves after cancellation cannot revert the cancelled row", async () => {
  const ui = await dom();
  try {
    const active = job({ state: "queued" });
    const cancelled = { ...active, state: "cancelled" as const };
    const pendingRead = deferred<JobRecord>();
    const fixture = fakeClient({
      list: async () => (fixture.cancelIds.length > 0 ? [cancelled] : [active]),
      read: async () => pendingRead.promise,
      cancel: async () => cancelled,
    });
    await ui.render(<JobsWorkbench client={fixture.client} pollMs={60_000} />);
    const detailsButton = ui.queryButton("Details");
    if (!detailsButton) throw new Error("missing_details_button");
    await ui.click(detailsButton);
    expect(fixture.readIds).toContain(active.id);
    // Cancel while the detail read is still pending.
    const cancelButton = ui.queryButton("Cancel");
    if (!cancelButton) throw new Error("missing_cancel_button");
    await ui.click(cancelButton);
    const confirm = ui.queryButton("Cancel job");
    if (!confirm) throw new Error("missing_confirm_button");
    await ui.click(confirm);
    await ui.settle(20);
    expect(ui.text()).toContain("Cancelled");
    // Now the older detail response lands with the pre-cancel state.
    pendingRead.resolve(active);
    await ui.settle(20);
    expect(ui.text()).toContain("Cancelled");
    expect(ui.text()).not.toContain("Queued");
  } finally {
    await ui.close();
  }
});

test("a list response that resolves after cancellation cannot revert the cancelled row", async () => {
  const ui = await dom();
  try {
    const active = job({ state: "queued" });
    const cancelled = { ...active, state: "cancelled" as const };
    const staleList = deferred<JobRecord[]>();
    let listIndex = 0;
    const fixture = fakeClient({
      list: async () => {
        listIndex += 1;
        // Second list request starts before cancel and is left pending; the
        // post-cancel reconciliation is the third and resolves immediately.
        if (listIndex === 2) return staleList.promise;
        return fixture.cancelIds.length > 0 ? [cancelled] : [active];
      },
      cancel: async () => cancelled,
    });
    await ui.render(<JobsWorkbench client={fixture.client} pollMs={60_000} />);
    // Start a refresh that will resolve only after the cancel completes.
    const refreshButton = ui.queryButton("Refresh");
    if (!refreshButton) throw new Error("missing_refresh_button");
    await ui.click(refreshButton);
    expect(fixture.listCalls).toBe(2);
    const cancelButton = ui.queryButton("Cancel");
    if (!cancelButton) throw new Error("missing_cancel_button");
    await ui.click(cancelButton);
    const confirm = ui.queryButton("Cancel job");
    if (!confirm) throw new Error("missing_confirm_button");
    await ui.click(confirm);
    await ui.settle(20);
    expect(fixture.listCalls).toBe(3);
    expect(ui.text()).toContain("Cancelled");
    // The stale pre-cancel list lands last and must not win.
    staleList.resolve([active]);
    await ui.settle(20);
    expect(ui.text()).toContain("Cancelled");
    expect(ui.text()).not.toContain("Queued");
  } finally {
    await ui.close();
  }
});

test("in-flight reads are aborted on unmount and supersession without surfacing errors", async () => {
  const ui = await dom();
  let supersededSignal: AbortSignal | undefined;
  try {
    const pending = deferred<JobRecord[]>();
    const fixture = fakeClient({ list: () => pending.promise });
    await ui.render(<JobsWorkbench client={fixture.client} pollMs={60_000} />);
    const initialSignal = fixture.listSignals.at(-1);
    if (!initialSignal) throw new Error("missing_signal");
    expect(initialSignal.aborted).toBe(false);
    // A forced refresh supersedes the initial read: it is aborted, and the
    // page neither shows a failure nor loses its loading state.
    const refreshButton = ui.queryButton("Refresh");
    if (!refreshButton) throw new Error("missing_refresh_button");
    await ui.click(refreshButton);
    expect(initialSignal.aborted).toBe(true);
    supersededSignal = fixture.listSignals.at(-1);
    if (!supersededSignal) throw new Error("missing_superseded_signal");
    expect(supersededSignal.aborted).toBe(false);
    expect(ui.text()).not.toContain("could not be loaded");
  } finally {
    // Unmount aborts the remaining read as well.
    await ui.close();
    expect(supersededSignal?.aborted).toBe(true);
  }
});

test("focus returns to the cancel trigger after Keep and Escape, and to the row after success", async () => {
  const ui = await dom();
  try {
    const active = job({ state: "queued" });
    const cancelled = { ...active, state: "cancelled" as const };
    const fixture = fakeClient({
      list: async () => (fixture.cancelIds.length > 0 ? [cancelled] : [active]),
      cancel: async () => cancelled,
    });
    await ui.render(<JobsWorkbench client={fixture.client} pollMs={60_000} />);
    // Keyboard path: focus the row's Cancel button and activate it.
    const cancelButton = ui.queryButton("Cancel");
    if (!cancelButton) throw new Error("missing_cancel_button");
    cancelButton.focus();
    expect(ui.activeElement()).toBe("Cancel");
    await ui.click(cancelButton);
    expect(ui.text()).toContain("Cancel this durable job?");

    // Escape dismisses and returns focus to the same row's Cancel button.
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await ui.settle(20);
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(ui.activeElement()).toBe("Cancel");

    // Keep job also returns focus to the trigger.
    await ui.click(cancelButton);
    const keep = ui.queryInDialog("Keep job");
    if (!keep) throw new Error("missing_keep_button");
    await ui.click(keep);
    await ui.settle(20);
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(ui.activeElement()).toBe("Cancel");

    // Successful cancellation: the Cancel button disappears; focus lands on
    // the same row's stable Details control.
    await ui.click(cancelButton);
    const confirm = ui.queryInDialog("Cancel job");
    if (!confirm) throw new Error("missing_confirm_button");
    await ui.click(confirm);
    await ui.settle(40);
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(ui.activeElement()).toBe("Details");
  } finally {
    await ui.close();
  }
});

test("background polling runs only while a non-terminal job exists", async () => {
  const ui = await dom();
  try {
    const terminal = fakeClient({
      list: async () => [job({ state: "completed" })],
    });
    await ui.render(<JobsWorkbench client={terminal.client} pollMs={40} />);
    await ui.settle(160);
    expect(terminal.listCalls).toBe(1);

    const active = fakeClient({
      list: async () => [job({ state: "running" })],
    });
    await ui.render(<JobsWorkbench client={active.client} pollMs={40} />);
    await ui.settle(160);
    expect(active.listCalls).toBeGreaterThan(1);
  } finally {
    await ui.close();
  }
});
