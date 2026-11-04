import { afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const browser = new Window({ url: "http://localhost" });
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "sessionStorage",
])
  Object.defineProperty(globalThis, key, {
    value:
      key === "window"
        ? browser
        : (browser as unknown as Record<string, unknown>)[key],
    configurable: true,
    writable: true,
  });

const sent: Array<{ email: string; token: string }> = [];
mock.module("@/lib/auth/client", () => ({
  authClient: {
    signIn: { social: async () => ({}), emailOtp: async () => ({}) },
    emailOtp: {
      sendVerificationOtp: async (input: {
        email: string;
        fetchOptions: { headers: Record<string, string> };
      }) => {
        sent.push({
          email: input.email,
          token: input.fetchOptions.headers["x-turnstile-token"],
        });
        return {};
      },
    },
  },
}));
// next/script loads over the network; report ready as soon as it mounts.
mock.module("next/script", () => {
  const { useEffect } = require("react") as typeof import("react");
  return {
    default: ({ onReady }: { onReady?: () => void }) => {
      useEffect(() => onReady?.(), [onReady]);
      return null;
    },
  };
});

const { render, fireEvent, cleanup, act, waitFor } = await import(
  "@testing-library/react"
);
const { SignInPanel } = await import("../../components/auth/sign-in");

afterEach(() => {
  cleanup();
  sent.length = 0;
  Reflect.deleteProperty(window, "turnstile");
});

// Without a delay the token never arrives on its own; the test delivers it.
function fakeTurnstile(tokenDelayMs?: number) {
  const options: Array<Record<string, unknown>> = [];
  Object.defineProperty(window, "turnstile", {
    configurable: true,
    value: {
      render(_: HTMLElement, o: Record<string, unknown>) {
        options.push(o);
        if (tokenDelayMs !== undefined)
          setTimeout(
            () => (o.callback as (token: string) => void)("late-token"),
            tokenDelayMs,
          );
        return "widget";
      },
      reset() {},
    },
  });
  return options;
}

test("a token that arrives after the click shows pending, then sends once", async () => {
  const options = fakeTurnstile();
  const ui = render(<SignInPanel siteKey="key" />);
  const email = ui.getByLabelText("Email") as HTMLInputElement;
  fireEvent.focus(email);
  await waitFor(() => expect(options).toHaveLength(1));
  expect(options[0]).toMatchObject({
    sitekey: "key",
    appearance: "interaction-only",
    size: "flexible",
  });
  fireEvent.change(email, { target: { value: "ada@example.com" } });
  const submit = ui.getByRole("button", { name: "Email me a code" });
  expect(submit.hasAttribute("disabled")).toBe(false);
  fireEvent.click(submit);
  await waitFor(() => expect(submit.getAttribute("aria-busy")).toBe("true"));
  expect(sent).toEqual([]);
  expect(
    ui
      .getByRole("button", { name: "Continue with GitHub" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await act(async () =>
    (options[0]?.callback as (token: string) => void)("late-token"),
  );
  await waitFor(() =>
    expect(sent).toEqual([{ email: "ada@example.com", token: "late-token" }]),
  );
  await waitFor(() => ui.getByLabelText("Six-digit code"));
  expect(email.disabled).toBe(true);
  expect(ui.queryByRole("button", { name: "Change" })).not.toBeNull();
});

test("an invalid email shows its error under the field and sends nothing", async () => {
  fakeTurnstile(0);
  const ui = render(<SignInPanel siteKey="key" />);
  fireEvent.click(ui.getByRole("button", { name: "Email me a code" }));
  await act(async () => {});
  expect(ui.getByText("Enter a valid email address.")).toBeTruthy();
  expect(sent).toEqual([]);
});
