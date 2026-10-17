import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionApproval } from "../components/tools/action-approval";
import { ToolTrace } from "../components/tools/tools-workbench";
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
