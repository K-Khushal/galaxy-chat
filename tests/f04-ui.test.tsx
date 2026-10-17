import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SignInPanel } from "../components/auth/sign-in";
import { ChatInput } from "../components/chat/chat-input";
import { getPaginatedChatHistory } from "../components/sidebar/sidebar-history";
import { uiHarnessEnabled } from "../lib/ui/availability";
import { canSendMessage } from "../lib/ui/composer";
import {
  type PlatformCreditView,
  toCreditStatus,
} from "../lib/ui/credit-contract";
import { creditStatusLabel, formatTokenUsage } from "../lib/ui/credits";
import { scrollBehavior } from "../lib/ui/motion";
import { fixtureHistory } from "../lib/ui/preview-fixtures";

const credits: PlatformCreditView = {
  funding: "platform",
  configured: true,
  state: "available",
  allowanceMicrodollars: 500000,
  remainingMicrodollars: 350000,
  creditMicrodollars: 100000,
  resetsAt: "2026-10-18T00:00:00Z",
};

test("preview requires both the opt-in flag and a development runtime", () => {
  expect(
    uiHarnessEnabled({ NODE_ENV: "development", F04_UI_HARNESS: "1" }),
  ).toBe(true);
  expect(uiHarnessEnabled({ NODE_ENV: "development" })).toBe(false);
  expect(
    uiHarnessEnabled({ NODE_ENV: "production", F04_UI_HARNESS: "1" }),
  ).toBe(false);
  expect(uiHarnessEnabled({ NODE_ENV: "test", F04_UI_HARNESS: "1" })).toBe(
    false,
  );
});
test("credit state wins over a numeric balance and never invents available funds", () => {
  expect(toCreditStatus({ ...credits, state: "disabled" })).toEqual({
    state: "unavailable",
    reason: "metering_pending",
  });
  expect(toCreditStatus({ ...credits, configured: false })).toEqual({
    state: "unavailable",
    reason: "metering_pending",
  });
  expect(creditStatusLabel(toCreditStatus(credits))).toBe(
    "3.5 credits available",
  );
  expect(toCreditStatus({ ...credits, state: "daily_exhausted" }).state).toBe(
    "exhausted",
  );
  expect(toCreditStatus({ ...credits, state: "shared_exhausted" }).state).toBe(
    "paused",
  );
  expect(toCreditStatus({ ...credits, state: "busy" }).state).toBe("paused");
});
test("history search remains encoded across cursor pagination and stops at the last page", () => {
  const first = new URL(
    getPaginatedChatHistory(0, null, "  A & B  ") ?? "",
    "https://example.test",
  );
  expect(first.searchParams.get("q")).toBe("A & B");
  const chats = fixtureHistory().slice(0, 15);
  const next = new URL(
    getPaginatedChatHistory(1, { chats, hasMore: true }, "A & B") ?? "",
    "https://example.test",
  );
  expect(next.searchParams.get("q")).toBe("A & B");
  expect(next.searchParams.get("ending_before")).toBe(chats.at(-1)?.id ?? null);
  expect(getPaginatedChatHistory(2, { chats: [], hasMore: false })).toBeNull();
});
test("composer rejects whitespace and duplicate busy submissions", () => {
  expect(canSendMessage("   ", false)).toBe(false);
  expect(canSendMessage("hello", true)).toBe(false);
  expect(canSendMessage("hello", false)).toBe(true);
});
test("paused composer keeps a readable draft but cannot submit or imply a live model", () => {
  const html = renderToStaticMarkup(
    <ChatInput
      text="Draft stays here"
      setText={() => {}}
      model=""
      setModel={() => {}}
      status="ready"
      stop={() => {}}
      onSend={() => {
        throw new Error("must not send");
      }}
    />,
  );
  expect(html).toContain("Draft stays here");
  expect(html).toMatch(/<button[^>]*aria-label="Send message"[^>]*disabled/);
  expect(html).toContain("Generation is paused");
  expect(html).toContain("Choose model");
});
test("streaming composer exposes stop even when the draft is empty", () => {
  const html = renderToStaticMarkup(
    <ChatInput
      text=""
      setText={() => {}}
      model=""
      setModel={() => {}}
      status="streaming"
      stop={() => {}}
      onSend={() => {}}
    />,
  );
  const stop = html.match(/<button[^>]*aria-label="Stop response"[^>]*>/)?.[0];
  expect(stop).toBeDefined();
  expect(stop).not.toMatch(/\sdisabled(?:=|\s|>)/);
});
test("unconfigured sign-in is visibly disabled and does not promise a session", () => {
  const html = renderToStaticMarkup(<SignInPanel configured={false} />);
  expect(html).toContain("No session is created");
  expect(html).toMatch(/<button[^>]*disabled/);
});
test("reduced motion disables programmatic smooth scroll and usage rejects invalid counts", () => {
  expect(scrollBehavior(true)).toBe("auto");
  expect(scrollBehavior(false)).toBe("smooth");
  expect(formatTokenUsage(Number.NaN)).toBeNull();
  expect(formatTokenUsage(-1)).toBeNull();
  expect(formatTokenUsage(undefined)).toBeNull();
  expect(formatTokenUsage(1200)).toBe("Last reply: 1,200 tokens");
});
