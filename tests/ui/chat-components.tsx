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
test("composer sends on Enter, preserves Shift+Enter, ignores composition and empty input", async () => {
  const sent: string[] = [];
  const ui = render(
    <Composer
      chatId="test"
      onSend={async (text) => {
        sent.push(text);
        return true;
      }}
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
  await act(async () => {});
  expect((input as HTMLTextAreaElement).value).toBe("");
});
test("running composer stops and never sends another Message", () => {
  let stops = 0;
  let sends = 0;
  const ui = render(
    <Composer
      chatId="busy"
      busy
      onSend={async () => {
        sends++;
        return true;
      }}
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
        return true;
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

test("keyboard edit Escape restores focus; Cancel and Save restore it too", () => {
  const ui = render(
    <Message
      message={{ ...message, role: "user" }}
      busy={false}
      streaming={false}
      onEdit={() => true}
      onRegenerate={() => {}}
      onContinue={() => {}}
      onSwitch={() => {}}
    />,
  );
  const edit = ui.getByRole("button", { name: "Edit Message" });
  edit.focus();
  // Native button keyboard activation dispatches click.
  fireEvent.click(edit, { detail: 0 });
  const input = ui.getByRole("textbox");
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "Keep this edit" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(document.activeElement).toBe(edit);
  fireEvent.click(edit);
  fireEvent.click(ui.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(edit);
  fireEvent.click(edit);
  fireEvent.submit(ui.getByRole("textbox").closest("form") as HTMLFormElement);
  expect(document.activeElement).toBe(edit);
});
for (const outcome of [
  "no_credits",
  "needs_byok_key",
  "payload_too_large",
  "network",
  "busy",
]) {
  test(`composer retains draft on ${outcome}`, async () => {
    const ui = render(
      <Composer
        chatId={outcome}
        onSend={async () => {
          if (outcome === "busy") return false;
          throw new Error(outcome);
        }}
        onStop={() => {}}
      />,
    );
    const input = ui.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Do not lose this" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(input.value).toBe("Do not lose this");
    expect(localStorage.getItem(`galaxy:draft:${outcome}`)).toBe(
      "Do not lose this",
    );
  });
}
test("draft remains while acceptance is pending and preserves newer typing", async () => {
  let accept!: (ok: boolean) => void;
  const ui = render(
    <Composer
      chatId="pending"
      onSend={() =>
        new Promise((resolve) => {
          accept = resolve;
        })
      }
      onStop={() => {}}
    />,
  );
  const input = ui.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "First" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe("First");
  fireEvent.change(input, { target: { value: "Next" } });
  await act(async () => accept(true));
  expect(input.value).toBe("Next");
});
for (const payment of ["credits", "byok"] as const) {
  test(`failed Reply explains ${payment} payment`, () => {
    const ui = render(
      <Message
        message={{ ...message, status: "failed", parts: [], payment }}
        busy={false}
        streaming={false}
        onEdit={() => true}
        onRegenerate={() => {}}
        onContinue={() => {}}
        onSwitch={() => {}}
      />,
    );
    expect(
      ui.getByText(
        payment === "byok" ? /No Credits were used/ : /You weren’t charged/,
      ),
    ).toBeTruthy();
    expect(ui.queryByRole("button", { name: "Continue" })).toBeNull();
  });
}
const { renderHook } = await import("@testing-library/react");
const { useGalaxyChat } = await import("../../components/chat/use-galaxy-chat");
const initial = {
  chat: {
    id: "hook",
    model: "openai/gpt-6-luna",
    title: null,
    pinned: false,
    archived: false,
    activeLeafMessageId: null,
    createdAt: "",
    updatedAt: "",
  },
  messages: [],
  generation: null,
};
for (const code of [
  "no_credits",
  "needs_byok_key",
  "payload_too_large",
  "network",
]) {
  test(`send returns false and removes optimistic Message for ${code}`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      if (code === "network") throw new TypeError("Failed to fetch");
      return Response.json(
        { error: code },
        { status: code === "payload_too_large" ? 413 : 402 },
      );
    }) as unknown as typeof fetch;
    try {
      const { result } = renderHook(() => useGalaxyChat(initial));
      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.send("Keep my text");
      });
      expect(ok).toBe(false);
      expect(result.current.messages).toEqual([]);
      expect(result.current.error).toBeTruthy();
    } finally {
      globalThis.fetch = original;
    }
  });
}
test("busy Chat refuses send explicitly", async () => {
  const { result } = renderHook(() =>
    useGalaxyChat({ ...initial, generation: { messageId: "active" } }),
  );
  await act(async () => {
    expect(await result.current.send("Keep my text")).toBe(false);
  });
});

test("server acceptance resolves send before the Reply stream ends", async () => {
  const original = globalThis.fetch;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
    if (options?.method !== "POST") return Response.json(initial);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
        },
      }),
      {
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      },
    );
  }) as unknown as typeof fetch;
  try {
    const { result } = renderHook(() => useGalaxyChat(initial));
    await act(async () => {
      expect(await result.current.send("Accepted draft")).toBe(true);
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      stream.close();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  } finally {
    globalThis.fetch = original;
  }
});
test("rejected edit keeps its text available", async () => {
  const ui = render(
    <Message
      message={{ ...message, role: "user" }}
      busy={false}
      streaming={false}
      onEdit={async () => false}
      onRegenerate={() => {}}
      onContinue={() => {}}
      onSwitch={() => {}}
    />,
  );
  fireEvent.click(ui.getByRole("button", { name: "Edit Message" }));
  fireEvent.change(ui.getByRole("textbox"), {
    target: { value: "Keep edited text" },
  });
  await act(async () => {
    fireEvent.submit(
      ui.getByRole("textbox").closest("form") as HTMLFormElement,
    );
  });
  expect((ui.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "Keep edited text",
  );
});
