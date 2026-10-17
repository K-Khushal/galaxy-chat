import { expect, test } from "bun:test";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { renderToStaticMarkup } from "react-dom/server";
import { GuestChat } from "../components/guest/guest-chat";
import { createGuestClient } from "../lib/guest/client";
import {
  guestErrorMessage,
  guestPromptBytes,
  guestViewSchema,
} from "../lib/guest/contract";
import { rejectionOf } from "./helpers/rejection";

const available = {
  state: "available" as const,
  remainingGenerations: 1,
  siteKey: "fixture-site-key",
};
function wire(chunks: UIMessageChunk[]) {
  return createUIMessageStreamResponse({
    stream: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  });
}
const chunks = (text: string): UIMessageChunk[] => [
  { type: "start", messageId: "fixture" },
  { type: "text-start", id: "text" },
  { type: "text-delta", id: "text", delta: text },
  { type: "text-end", id: "text" },
  { type: "finish", finishReason: "stop" },
];
const input = {
  requestId: crypto.randomUUID(),
  text: "Prompt",
  botToken: "fixture-token",
};
test("guest public view fails closed and input byte accounting includes Unicode/JSON framing", () => {
  expect(
    guestViewSchema.parse({ state: "available", remainingGenerations: 1 })
      .state,
  ).toBe("disabled");
  expect(
    guestViewSchema.parse({ ...available, remainingGenerations: 0 }).state,
  ).toBe("disabled");
  expect(
    guestViewSchema.safeParse({ ...available, siteKey: "<script>" }).success,
  ).toBe(false);
  expect(guestPromptBytes("a".repeat(1998))).toBe(2000);
  expect(guestPromptBytes("😀")).toBe(6);
  expect(guestPromptBytes('"')).toBe(4);
});
test("shared guest UI contains hostile Markdown as escaped text and exposes limits/stop/sign-in without advanced controls", () => {
  const hostile =
    "<script>alert(1)</script><img src=x onerror=alert(1)> [link](javascript:alert(1)) ![remote](https://example.invalid/pixel)";
  const html = renderToStaticMarkup(
    <GuestChat
      fixture
      initialView={available}
      initialPhase="streaming"
      initialAnswer={hostile}
    />,
  );
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('src="https://example.invalid');
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("Stop response");
  expect(html).toContain('href="/sign-in"');
  expect(html).toContain('for="guest-prompt"');
  expect(html).toContain("One generation");
  expect(html).not.toContain('type="password"');
  expect(html).not.toContain('type="file"');
  expect(html).not.toContain("Choose model");
  const disabled = renderToStaticMarkup(
    <GuestChat initialView={{ state: "disabled", remainingGenerations: 0 }} />,
  );
  expect(disabled).toContain("currently unavailable");
  expect(disabled).not.toContain("challenges.cloudflare.com");
  expect(disabled).toMatch(/<textarea[^>]*disabled/);
  const used = renderToStaticMarkup(
    <GuestChat initialView={{ state: "used", remainingGenerations: 0 }} />,
  );
  expect(used).toContain("Sign in to continue");
  expect(used).toContain("does not save or transfer");
});
test("installed SDK guest transport uses strict endpoint/body, bounds text and rejects incomplete/errors without diagnostic leaks", async () => {
  let path = "";
  let sent: unknown;
  let answer = "";
  const client = createGuestClient(async (url, options) => {
    path = String(url);
    sent = JSON.parse(String(options?.body));
    return wire(chunks("Actual SDK fixture text"));
  });
  await client.generate(input, new AbortController().signal, (text) => {
    answer = text;
  });
  expect(path).toBe("/api/guest");
  expect(sent).toEqual(input);
  expect(answer).toBe("Actual SDK fixture text");
  const tooLarge = createGuestClient(async () =>
    wire(chunks("x".repeat(32_001))),
  );
  expect(
    await rejectionOf(
      tooLarge.generate(input, new AbortController().signal, () => {}),
    ),
  ).toMatchObject({ message: "guest_output_limit" });
  const incomplete = createGuestClient(async () =>
    wire(chunks("partial").slice(0, -1)),
  );
  expect(
    await rejectionOf(
      incomplete.generate(input, new AbortController().signal, () => {}),
    ),
  ).toMatchObject({ message: "provider_failed" });
  const failed = createGuestClient(async () =>
    Response.json(
      { error: { id: "guest_limit_reached", secret: "must not surface" } },
      { status: 429 },
    ),
  );
  expect(
    await rejectionOf(
      failed.generate(input, new AbortController().signal, () => {}),
    ),
  ).toMatchObject({ message: "guest_limit_reached" });
  expect(guestErrorMessage("raw-provider-key-must-not-surface")).not.toContain(
    "raw-provider-key",
  );
});
