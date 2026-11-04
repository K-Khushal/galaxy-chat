import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { chatSpend, UsageMeterView } from "../components/chat/usage-meter";
import type { ChatMessage } from "../lib/chat/store";

const CREDIT_MODEL = "openai/gpt-6-luna";
const KEY_MODEL = "anthropic/claude-opus-5.5";

const meter = (props: {
  model?: string;
  credits: number | null;
  hasKey: boolean | null;
  spend?: { credits: number; cost: number };
}) =>
  renderToStaticMarkup(
    <UsageMeterView model={props.model ?? CREDIT_MODEL} {...props} />,
  );

test("while loading, a skeleton holds the slot", () => {
  const html = meter({ credits: null, hasKey: null });
  expect(html).toContain('data-slot="skeleton"');
  expect(html).not.toContain("Credits left");
});

test("a Credit model with Credits left shows them, and warns at two or fewer", () => {
  const plenty = meter({ credits: 10, hasKey: false });
  expect(plenty).toContain("10 Credits left");
  expect(plenty).not.toContain("text-warning");
  expect(meter({ credits: 3, hasKey: false })).not.toContain("text-warning");
  const low = meter({ credits: 2, hasKey: false });
  expect(low).toContain("2 Credits left");
  expect(low).toContain("text-warning");
  const one = meter({ credits: 1, hasKey: true });
  expect(one).toContain("1 Credit left");
  expect(one).not.toContain("1 Credits");
});

test("when the key pays, the meter shows your key and this Chat's reported cost", () => {
  const unused = meter({ credits: 0, hasKey: true });
  expect(unused).toContain("Your key");
  expect(unused).not.toContain("Credits left");
  expect(
    meter({ credits: 0, hasKey: true, spend: { credits: 0, cost: 0 } }),
  ).toContain("Your key");
  const spent = meter({
    credits: 0,
    hasKey: true,
    spend: { credits: 2, cost: 0.0042 },
  });
  expect(spent).toContain("$0.0042");
  expect(spent).not.toContain("Your key</");
  // A model that Credits can't pay for goes to the key even with Credits left.
  expect(meter({ model: KEY_MODEL, credits: 7, hasKey: true })).toContain(
    "Your key",
  );
});

test("with no Credits and no key the meter reads 0 Credits left in the error colour", () => {
  for (const props of [
    { credits: 0, hasKey: false },
    { model: KEY_MODEL, credits: 7, hasKey: false },
  ]) {
    const html = meter(props);
    expect(html).toContain("0 Credits left");
    expect(html).toContain("text-destructive");
  }
});

const reply = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m",
  parentId: null,
  role: "assistant",
  parts: [],
  status: "complete",
  model: CREDIT_MODEL,
  payment: null,
  usage: null,
  error: null,
  createdAt: "",
  versions: { ids: ["m"], index: 0 },
  ...over,
});

test("chatSpend counts Credits Replies and sums reported BYOK cost", () => {
  expect(chatSpend([])).toEqual({ credits: 0, cost: 0 });
  expect(
    chatSpend([
      reply({ role: "user" }),
      reply({ payment: "credits" }),
      reply({ payment: "credits", status: "stopped" }),
      reply({ payment: "credits", status: "failed" }),
      reply({ payment: "byok", usage: { cost: 0.002 } }),
      reply({ payment: "byok", usage: { cost: 0.0005 } }),
      reply({ payment: "byok", usage: null }),
      reply({ payment: null }),
    ]),
  ).toEqual({ credits: 2, cost: 0.0025 });
});
