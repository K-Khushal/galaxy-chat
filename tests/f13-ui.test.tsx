import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionApproval } from "../components/tools/action-approval";
import { ToolsWorkbench, ToolTrace } from "../components/tools/tools-workbench";
import type { ToolClient } from "../lib/tools/client";
import { microdollarsFromUSD, type ToolState } from "../lib/tools/contract";

test("F13 tool results remain escaped untrusted text across every visible state", () => {
  const states: ToolState[] = [
    "queued",
    "running",
    "completed",
    "denied",
    "failed",
  ];
  const html = renderToStaticMarkup(
    <ToolTrace
      run={{
        id: "fixture",
        state: "completed",
        answer: "<script>unsafe()</script>",
        events: states.map((state, index) => ({
          id: String(index),
          name: "readRevision",
          state,
          output: '<img src="https://evil.invalid" onerror="unsafe()">',
        })),
      }}
    />,
  );
  for (const state of ["queued", "running", "completed", "denied", "failed"])
    expect(html).toContain(state);
  expect(html).toContain("View untrusted result");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
});
test("F13 approval presentation exposes exact target, arguments and cost without authorizing effects", () => {
  let decisions = 0;
  const html = renderToStaticMarkup(
    <ActionApproval
      target="<script>target</script>"
      argumentsText={'{"title":"<img src=x>"}'}
      cost="$0.01"
      state="pending"
      onDecision={async () => {
        decisions++;
      }}
    />,
  );
  expect(html).toContain("Approve action");
  expect(html).toContain("Deny action");
  expect(html).toContain("$0.01");
  expect(html).toContain("20 seconds after");
  expect(html).toContain("the original run started");
  expect(html).not.toContain("five minutes");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  expect(decisions).toBe(0);
});
test("F13 USD ceilings parse decimal money without floating point multiplication", () => {
  expect(microdollarsFromUSD("0.000073")).toBe(73);
  expect(microdollarsFromUSD("0.0012")).toBe(1200);
  expect(microdollarsFromUSD("2000")).toBe(2_000_000_000);
  for (const value of ["-1", "Infinity", "1e3", "0.0000001", "2001", "0", ""])
    expect(microdollarsFromUSD(value)).toBeUndefined();
});

test("F13 disabled tools notice renders as one block box", async () => {
  const window = new Window();
  const globals = {
    window,
    document: window.document,
    Event: window.Event,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = Object.entries(globals).map(([name, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
    return { name, descriptor };
  });
  const client: ToolClient = {
    catalog: async () => ({ models: [], credentials: [], revisions: [] }),
    run: async () => {
      throw new Error("fixture_run_unavailable");
    },
    view: async () => {
      throw new Error("fixture_view_unavailable");
    },
    remove: async () => {},
  };
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ToolsWorkbench client={client} />));
    const output = [...container.querySelectorAll("output")].find((node) =>
      node.textContent?.includes("Tools are off"),
    );
    expect(output).toBeDefined();
    expect(output?.classList.contains("block")).toBe(true);
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const { name, descriptor } of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
