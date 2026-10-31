import { afterEach, expect, test } from "bun:test";
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
  "localStorage",
])
  Object.defineProperty(globalThis, key, {
    value:
      key === "window"
        ? browser
        : (browser as unknown as Record<string, unknown>)[key],
    configurable: true,
    writable: true,
  });
const { render, fireEvent, cleanup, act } = await import(
  "@testing-library/react"
);
const { Composer } = await import("../../components/chat/composer");
const { ReplyActions } = await import("../../components/chat/reply-actions");
const { VersionSwitcher } = await import(
  "../../components/chat/version-switcher"
);
const { Message } = await import("../../components/chat/message");
const message = {
  id: "reply",
  parentId: "user",
  role: "assistant" as const,
  parts: [{ type: "text" as const, text: "Hello" }],
  status: "complete" as const,
  model: "test/model",
  payment: null,
  usage: null,
  error: null,
  createdAt: "",
  versions: { ids: ["reply", "other"], index: 0 },
};
afterEach(cleanup);
test("composer sends on Enter, preserves Shift+Enter, ignores composition and empty input", () => {
  const sent: string[] = [];
  const ui = render(
    <Composer
      chatId="test"
      onSend={(text) => sent.push(text)}
      onStop={() => {}}
    />,
  );
  const input = ui.getByRole("textbox");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(sent).toEqual([]);
  fireEvent.change(input, { target: { value: "Hello" } });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(sent).toEqual([]);
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(sent).toEqual([]);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(sent).toEqual(["Hello"]);
  expect((input as HTMLTextAreaElement).value).toBe("");
});
test("running composer stops and never sends another Message", () => {
  let stops = 0;
  let sends = 0;
  const ui = render(
    <Composer
      chatId="busy"
      busy
      onSend={() => sends++}
      onStop={() => stops++}
    />,
  );
  fireEvent.change(ui.getByRole("textbox"), { target: { value: "Draft" } });
  fireEvent.keyDown(ui.getByRole("textbox"), { key: "Enter" });
  fireEvent.click(ui.getByRole("button", { name: "Stop Reply" }));
  expect(stops).toBe(1);
  expect(sends).toBe(0);
});
test("Reply copies plain text and regenerates; busy disables regenerate", async () => {
  let copied = "";
  let regenerated = 0;
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async (text: string) => {
        copied = text;
      },
    },
    configurable: true,
  });
  const ui = render(
    <ReplyActions
      message={message}
      disabled={false}
      onRegenerate={() => regenerated++}
    />,
  );
  await act(async () => {
    fireEvent.click(ui.getByRole("button", { name: "Copy Reply" }));
  });
  expect(copied).toBe("Hello");
  fireEvent.click(ui.getByRole("button", { name: "Regenerate Reply" }));
  expect(regenerated).toBe(1);
  ui.rerender(
    <ReplyActions
      message={message}
      disabled
      onRegenerate={() => regenerated++}
    />,
  );
  expect(
    (ui.getByRole("button", { name: "Regenerate Reply" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
test("Version switcher respects boundaries and selects sibling ID", () => {
  let selected = "";
  const ui = render(
    <VersionSwitcher
      versions={message.versions}
      disabled={false}
      onSwitch={(id) => {
        selected = id;
      }}
    />,
  );
  expect(
    (ui.getByRole("button", { name: "Previous Version" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(ui.getByRole("button", { name: "Next Version" }));
  expect(selected).toBe("other");
});
test("editing a User Message submits new text and Cancel keeps the original", () => {
  let edited = "";
  const ui = render(
    <Message
      message={{ ...message, role: "user" }}
      busy={false}
      streaming={false}
      onEdit={(text) => {
        edited = text;
      }}
      onRegenerate={() => {}}
      onContinue={() => {}}
      onSwitch={() => {}}
    />,
  );
  fireEvent.click(ui.getByRole("button", { name: "Edit Message" }));
  fireEvent.change(ui.getByRole("textbox"), { target: { value: "Edited" } });
  expect(
    (ui.getByRole("button", { name: "Save and send" }) as HTMLButtonElement)
      .type,
  ).toBe("submit");
  fireEvent.submit(
    ui
      .getByRole("button", { name: "Save and send" })
      .closest("form") as HTMLFormElement,
  );
  expect(edited).toBe("Edited");
  fireEvent.click(ui.getByRole("button", { name: "Edit Message" }));
  fireEvent.click(ui.getByRole("button", { name: "Cancel" }));
  expect(ui.queryByRole("textbox")).toBeNull();
});
