import { expect, mock, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Response as MarkdownResponse } from "../components/elements/response";
import { env, privateKey } from "./helpers/beta-fixture";

mock.module("server-only", () => ({}));
const { gatewayProvider } = await import("../lib/credits/service");
const { resolveFundingConfig } = await import("../lib/credits/config");
test("F08 existing signed-in Markdown renderer strips active HTML and script protocols", () => {
  const html = renderToStaticMarkup(
    <MarkdownResponse mode="static">
      {
        '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)" />\n\n[click](javascript:alert(1))\n\n[encoded](jav&#x61;script:alert(1))\n\n<iframe src="https://example.invalid"></iframe>'
      }
    </MarkdownResponse>,
  );
  expect(html).not.toContain("<script");
  expect(html).not.toContain("onerror=");
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain("<iframe");
});
test("F08 funded SDK adapter drops diagnostic warnings/metadata before logger and UI without enabling Gateway funding", async () => {
  const warning = spyOn(process, "emitWarning").mockImplementation(() => {});
  const consoleWarning = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const fetcher = Object.assign(
      async () =>
        new Response(
          [
            {
              type: "stream-start",
              warnings: [{ type: "other", message: privateKey }],
            },
            { type: "text-start", id: "text" },
            {
              type: "text-delta",
              id: "text",
              delta: "safe fixture answer",
              providerMetadata: { debug: { credential: privateKey } },
            },
            { type: "text-end", id: "text" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: {
                  total: 8,
                  noCache: 8,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 2, text: 2, reasoning: 0 },
              },
            },
          ]
            .map((part) => `data: ${JSON.stringify(part)}\n\n`)
            .join(""),
          { headers: { "content-type": "text/event-stream" } },
        ),
      { preconnect: fetch.preconnect },
    );
    let uncertain = 0;
    const provider = gatewayProvider(
      { AI_GATEWAY_API_KEY: "nonfunctional-fixture-only" },
      fetcher,
    );
    const result = provider(
      resolveFundingConfig(env),
      [{ role: "user", content: "fixture" }],
      {
        uncertain: () => {
          uncertain++;
        },
        complete: async () => {
          throw new Error("unverified receipt must not settle");
        },
      },
    );
    let wire = "";
    const reader = result.stream.getReader();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        wire += JSON.stringify(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    await result.consume();
    expect(wire).toContain("safe fixture answer");
    expect(wire).not.toContain(privateKey);
    expect(wire).not.toContain("debug");
    expect(warning).not.toHaveBeenCalled();
    expect(consoleWarning).not.toHaveBeenCalled();
    expect(uncertain).toBeGreaterThan(0);
    expect(() =>
      resolveFundingConfig({ ...env, FUNDED_ADAPTER: "gateway" }),
    ).toThrow("gateway_receipts_unverified");
  } finally {
    warning.mockRestore();
    consoleWarning.mockRestore();
  }
});
