import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RequestContextSummary } from "../components/chat/context-picker";
import { CONTEXT_LIMITS, type ContextView } from "../lib/context/contract";
import { temporaryHistory } from "../lib/context/transient";
import type { TypeUIMessage } from "../lib/types";

test("F09 exact selected memory disclosure escapes content and explains the real shared bounds", () => {
  const view: ContextView = {
    project: null,
    memories: [{ id: "chosen", content: '<script>alert("private")</script>' }],
    instructions: "instruction",
    digest: "f".repeat(64),
    instructionBytes: 120,
    limits: CONTEXT_LIMITS,
  };
  const html = renderToStaticMarkup(<RequestContextSummary view={view} />);
  expect(html).toContain("Exact selected memories");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("120");
  expect(html).toContain("4,500");
  expect(html).toContain("12,000");
  expect(html).toContain("16,384");
  expect(html).toContain("512");
  const empty = renderToStaticMarkup(
    <RequestContextSummary view={{ ...view, memories: [] }} />,
  );
  expect(empty).toContain("None. No saved memory enters this request.");
});
test("F09 temporary client sends only preceding text turns with the same 12-message context cap", () => {
  const messages: TypeUIMessage[] = [
    {
      id: "system",
      role: "system",
      parts: [{ type: "text", text: "Caller system data" }],
    },
    ...Array.from(
      { length: 14 },
      (_, index): TypeUIMessage => ({
        id: String(index),
        role: index % 2 ? "assistant" : "user",
        parts: [
          { type: "text", text: `previous-${index}` },
          { type: "reasoning", text: "Never retransmit reasoning" },
        ],
      }),
    ),
    {
      id: "current",
      role: "user",
      parts: [{ type: "text", text: "Current prompt in body.message" }],
    },
  ];
  const history = temporaryHistory(messages);
  expect(history).toHaveLength(11);
  expect(history[0].content).toBe("previous-3");
  expect(history.at(-1)?.content).toBe("previous-13");
  expect(JSON.stringify(history)).not.toContain("reasoning");
  expect(JSON.stringify(history)).not.toContain("system");
  expect(JSON.stringify(history)).not.toContain("Current prompt");
  expect(temporaryHistory([messages.at(-1) ?? messages[0]])).toEqual([]);
});
