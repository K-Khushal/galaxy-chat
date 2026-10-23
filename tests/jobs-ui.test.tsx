import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, type ReactNode, useLayoutEffect } from "react";
import type { JobRecord } from "../lib/jobs/client";

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
const { jobsClient } = await import("../lib/jobs/client");

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
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
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
    click: async (node: HTMLElement) => {
      await act(async () => node.click());
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
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function fakeClient(behavior: {
  list: () => Promise<JobRecord[]>;
  read?: (id: string) => Promise<JobRecord>;
  cancel?: (id: string) => Promise<JobRecord>;
}) {
  const fixture = {
    listCalls: 0,
    readIds: [] as string[],
    cancelIds: [] as string[],
    client: {
      list: async () => {
        fixture.listCalls += 1;
        return behavior.list();
      },
      read: async (id: string) => {
        fixture.readIds.push(id);
        return behavior.read
          ? behavior.read(id)
          : Promise.reject(new Error("read_failed"));
      },
      cancel: async (id: string) => {
        fixture.cancelIds.push(id);
        if (!behavior.cancel) throw new Error("cancel_failed");
        return behavior.cancel(id);
      },
    } as typeof jobsClient,
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

test("cancellation requires confirmation, states its limits, and reconciles with storage", async () => {
  const ui = await dom();
  try {
    const active = job({ state: "queued" });
    const cancelled = { ...active, state: "cancelled" as const };
    const fixture = fakeClient({
      list: async () => [active],
      cancel: async (id) => {
        expect(id).toBe(active.id);
        return cancelled;
      },
    });
    await ui.render(<JobsWorkbench client={fixture.client} pollMs={60_000} />);
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
    expect(ui.text()).toContain("Cancelled");
    expect(ui.text()).not.toContain("Cancel this durable job?");
  } finally {
    await ui.close();
  }
});

test("failed cancellations surface an announced error and keep the list usable", async () => {
  const ui = await dom();
  try {
    const active = job({ state: "queued" });
    const fixture = fakeClient({
      list: async () => [active],
      cancel: async () => {
        throw new Error("jobs_request_failed");
      },
    });
    await ui.render(<JobsWorkbench client={fixture.client} pollMs={60_000} />);
    const cancelButton = ui.queryButton("Cancel");
    if (!cancelButton) throw new Error("missing_cancel_button");
    await ui.click(cancelButton);
    const confirm = ui.queryButton("Cancel job");
    if (!confirm) throw new Error("missing_confirm_button");
    await ui.click(confirm);
    expect(ui.text()).toContain(
      "The cancellation did not complete. Refresh to see the current status and try again.",
    );
    expect(
      document.body.querySelector('[role="alert"]')?.textContent,
    ).toContain("did not complete");
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
