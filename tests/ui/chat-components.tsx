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

test("Temporary chats keep drafts in memory without persisting or sending them", async () => {
  const { TemporaryChat } = await import(
    "../../components/chat/temporary-chat"
  );
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = Object.assign(
    async (url: RequestInfo | URL) => {
      if (String(url) === "/api/byok") return Response.json({ key: null });
      calls++;
      throw new Error("Unexpected server write");
    },
    { preconnect: original.preconnect },
  );
  localStorage.clear();
  try {
    const ui = render(<TemporaryChat />);
    fireEvent.change(ui.getByRole("textbox"), {
      target: { value: "Private draft" },
    });
    expect(localStorage.length).toBe(0);
    expect(calls).toBe(0);
    ui.unmount();
    const fresh = render(<TemporaryChat />);
    expect((fresh.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  } finally {
    globalThis.fetch = original;
  }
});

test("Temporary sends client history, Stop aborts fetch and remount clears Messages", async () => {
  const { TemporaryChat } = await import(
    "../../components/chat/temporary-chat"
  );
  const original = globalThis.fetch;
  const bodies: {
    messages: { role: string; content: string }[];
    model: string;
  }[] = [];
  let signal: AbortSignal | undefined;
  globalThis.fetch = Object.assign(
    async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (String(_url) === "/api/byok") return Response.json({ key: null });
      bodies.push(JSON.parse(String(options?.body)));
      signal = options?.signal ?? undefined;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ type: "start", messageId: "temporary-reply" })}${String.fromCharCode(10).repeat(2)}`,
              ),
            );
            signal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          },
        }),
        {
          headers: {
            "content-type": "text/event-stream",
            "x-vercel-ai-ui-message-stream": "v1",
          },
        },
      );
    },
    { preconnect: original.preconnect },
  );
  localStorage.clear();
  try {
    const ui = render(<TemporaryChat />);
    fireEvent.change(ui.getByRole("textbox"), {
      target: { value: "Private question" },
    });
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Send message" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(bodies[0]?.messages).toEqual([
      { role: "user", content: "Private question" },
    ]);
    expect(bodies[0]?.model).toBeTruthy();
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Stop Reply" }));
    });
    expect(signal?.aborted).toBe(true);
    expect(localStorage.length).toBe(0);
    fireEvent.change(ui.getByRole("textbox"), {
      target: { value: "Another private draft" },
    });
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "New Temporary chat" }));
    });
    expect(ui.queryByText("Private question")).toBeNull();
    expect((ui.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    ui.unmount();
    const fresh = render(<TemporaryChat />);
    expect(fresh.queryByText("Private question")).toBeNull();
  } finally {
    globalThis.fetch = original;
  }
});

for (const status of ["failed", "interrupted"] as const) {
  test(`empty ${status} Reply has no Copy action`, () => {
    const ui = render(
      <ReplyActions
        message={{ ...message, status, parts: [] }}
        disabled={false}
        onRegenerate={() => {}}
      />,
    );
    expect(ui.queryByRole("button", { name: "Copy Reply" })).toBeNull();
  });
}
test("a transferred draft clears the new-Chat draft even after it was edited", async () => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("galaxy:draft:new", "Original, then edited");
  sessionStorage.setItem("galaxy:send:edited", "Original");
  render(
    <Composer
      chatId="edited"
      initialDraft="Original"
      autoSend
      onSend={async () => false}
      onStop={() => {}}
    />,
  );
  await act(async () => {});
  expect(localStorage.getItem("galaxy:draft:new")).toBeNull();
});
test("restoring a transferred draft consumes auto-send even when rejected", async () => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("galaxy:draft:new", "Original");
  sessionStorage.setItem("galaxy:send:transfer", "Original");
  let calls = 0;
  const send = async () => {
    calls++;
    return false;
  };
  const ui = render(
    <Composer
      chatId="transfer"
      initialDraft="Original"
      autoSend
      onSend={send}
      onStop={() => {}}
    />,
  );
  await act(async () => {});
  expect(calls).toBe(1);
  expect(sessionStorage.getItem("galaxy:send:transfer")).toBeNull();
  expect(localStorage.getItem("galaxy:draft:new")).toBeNull();
  fireEvent.change(ui.getByRole("textbox"), { target: { value: "Edited" } });
  ui.unmount();
  const fresh = render(
    <Composer
      chatId="transfer"
      autoSend={!!sessionStorage.getItem("galaxy:send:transfer")}
      onSend={send}
      onStop={() => {}}
    />,
  );
  expect((fresh.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "Edited",
  );
  expect(calls).toBe(1);
});

/**
 * Base UI menus and dialogs need animation frames; motion starts animating as
 * soon as they exist, so they are only present for the tests that open one.
 */
async function withAnimationFrames(run: () => Promise<void>) {
  const target = globalThis as Record<string, unknown>;
  target.requestAnimationFrame = (callback: (time: number) => void) =>
    setTimeout(() => callback(Date.now()), 0);
  target.cancelAnimationFrame = (id: number) => clearTimeout(id);
  try {
    await run();
  } finally {
    cleanup();
    delete target.requestAnimationFrame;
    delete target.cancelAnimationFrame;
  }
}

type Upload =
  typeof import("../../components/chat/attachment-upload")["uploadAttachment"];

/** An uploader the test drives by hand: progress, then success or failure. */
function fakeUploader() {
  const calls: {
    file: File;
    progress: (fraction: number) => void;
    finish: () => void;
    fail: (code: string) => void;
    signal: AbortSignal;
  }[] = [];
  const upload: Upload = (file, { onProgress, signal }) =>
    new Promise((resolve, reject) => {
      calls.push({
        file,
        progress: onProgress,
        signal,
        finish: () =>
          resolve({
            id: `id-${calls.length}`,
            filename: file.name,
            kind: file.type.startsWith("image/") ? "image" : "text",
            contentType: file.type || "text/plain",
            size: file.size,
          }),
        fail: (code) => reject(new Error(code)),
      });
    });
  return { upload, calls };
}

const pick = (ui: ReturnType<typeof render>, files: File[], index = 1) => {
  const inputs = ui.container.querySelectorAll('input[type="file"]');
  fireEvent.change(inputs[index] as HTMLInputElement, { target: { files } });
};
const file = (name: string, type: string, size = 100) =>
  new File([new Uint8Array(size)], name, { type });

test("attaching shows progress, blocks sending until verified, and sends the files", async () => {
  const { upload, calls } = fakeUploader();
  const sent: { text: string; ids: string[] }[] = [];
  const ui = render(
    <Composer
      chatId="files"
      upload={upload}
      onSend={async (text, attachments) => {
        sent.push({ text, ids: attachments.map((a) => a.id) });
        return true;
      }}
      onStop={() => {}}
    />,
  );
  pick(ui, [file("report.pdf", "application/pdf", 2048)]);
  expect(ui.getByText("report.pdf")).toBeTruthy();
  const bar = ui.getByRole("progressbar", { name: "Uploading report.pdf" });
  expect(bar.getAttribute("aria-valuenow")).toBe("0");
  act(() => calls[0]?.progress(0.5));
  expect(bar.getAttribute("aria-valuenow")).toBe("50");
  // Uploading: the Send button stays disabled, even with text.
  fireEvent.change(ui.getByRole("textbox"), { target: { value: "Summarise" } });
  const sendButton = ui.getByRole("button", { name: "Send message" });
  expect((sendButton as HTMLButtonElement).disabled).toBe(true);
  await act(async () => calls[0]?.finish());
  expect(ui.queryByRole("progressbar")).toBeNull();
  expect((sendButton as HTMLButtonElement).disabled).toBe(false);
  await act(async () => {
    fireEvent.submit(
      ui.getByRole("textbox").closest("form") as HTMLFormElement,
    );
  });
  expect(sent).toEqual([{ text: "Summarise", ids: ["id-1"] }]);
  // The files leave the draft once the Message is accepted.
  expect(ui.queryByText("report.pdf")).toBeNull();
});

test("a Message of only a file can be sent", async () => {
  const { upload, calls } = fakeUploader();
  const sent: string[][] = [];
  const ui = render(
    <Composer
      chatId="files-only"
      upload={upload}
      onSend={async (_text, attachments) => {
        sent.push(attachments.map((a) => a.filename));
        return true;
      }}
      onStop={() => {}}
    />,
  );
  pick(ui, [file("notes.txt", "text/plain")]);
  await act(async () => calls[0]?.finish());
  await act(async () => {
    fireEvent.submit(
      ui.getByRole("textbox").closest("form") as HTMLFormElement,
    );
  });
  expect(sent).toEqual([["notes.txt"]]);
});

test("files can be removed with the keyboard-reachable button, cancelling the upload", async () => {
  const { upload, calls } = fakeUploader();
  const ui = render(
    <Composer
      chatId="remove"
      upload={upload}
      onSend={async () => true}
      onStop={() => {}}
    />,
  );
  pick(ui, [file("a.txt", "text/plain")]);
  const remove = ui.getByRole("button", { name: "Remove a.txt" });
  fireEvent.click(remove);
  expect(calls[0]?.signal.aborted).toBe(true);
  expect(ui.queryByText("a.txt")).toBeNull();
});

test("the composer enforces five files, 10 MB and the type list before uploading", async () => {
  const { upload, calls } = fakeUploader();
  const ui = render(
    <Composer
      chatId="limits"
      upload={upload}
      onSend={async () => true}
      onStop={() => {}}
    />,
  );
  pick(ui, [
    ...Array.from({ length: 6 }, (_, i) => file(`f${i}.txt`, "text/plain")),
    file("huge.png", "image/png", 10 * 1024 * 1024 + 1),
    file("movie.mp4", "video/mp4"),
  ]);
  expect(calls).toHaveLength(5);
  const alert = ui.getByRole("alert").textContent ?? "";
  expect(alert).toContain("up to 5 files");
  expect(alert).toContain("larger than 10 MB");
  expect(alert).toContain("can’t be attached");
});

test("dropping and pasting files attach them; pasting text does not", async () => {
  const { upload, calls } = fakeUploader();
  const ui = render(
    <Composer
      chatId="dnd"
      upload={upload}
      onSend={async () => true}
      onStop={() => {}}
    />,
  );
  const form = ui.getByRole("textbox").closest("form") as HTMLFormElement;
  const dropped = file("drop.txt", "text/plain");
  fireEvent.dragOver(form, {
    dataTransfer: { types: ["Files"], files: [dropped] },
  });
  expect(ui.getByText("Drop files to attach them.")).toBeTruthy();
  fireEvent.drop(form, {
    dataTransfer: { types: ["Files"], files: [dropped] },
  });
  expect(calls.map((c) => c.file.name)).toEqual(["drop.txt"]);

  const image = file("shot.png", "image/png");
  fireEvent.paste(ui.getByRole("textbox"), {
    clipboardData: { files: [image], getData: () => "" },
  });
  expect(calls.map((c) => c.file.name)).toEqual(["drop.txt", "shot.png"]);
  // A paste carrying text keeps its normal behaviour.
  fireEvent.paste(ui.getByRole("textbox"), {
    clipboardData: {
      files: [file("x.png", "image/png")],
      getData: () => "copied words",
    },
  });
  expect(calls).toHaveLength(2);
});

test("a failed upload explains itself and blocks Send until removed", async () => {
  const { upload, calls } = fakeUploader();
  const ui = render(
    <Composer
      chatId="fail"
      upload={upload}
      onSend={async () => true}
      onStop={() => {}}
    />,
  );
  pick(ui, [file("bad.png", "image/png")]);
  await act(async () => calls[0]?.fail("attachment_invalid"));
  expect(ui.getByText(/doesn’t look like the type it says it is/)).toBeTruthy();
  fireEvent.change(ui.getByRole("textbox"), { target: { value: "Hi" } });
  const send = ui.getByRole("button", {
    name: "Send message",
  }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.click(ui.getByRole("button", { name: "Remove bad.png" }));
  expect(send.disabled).toBe(false);
});

test("a model that cannot read images turns off photos and refuses dropped images", () =>
  withAnimationFrames(async () => {
    const { upload, calls } = fakeUploader();
    const ui = render(
      <Composer
        chatId="vision"
        model="acme/text-only"
        upload={upload}
        onSend={async () => true}
        onStop={() => {}}
      />,
    );
    fireEvent.click(ui.getByRole("button", { name: "Add attachment" }));
    const photos = await ui.findByRole("menuitem", { name: /Add photos/ });
    expect(photos.getAttribute("aria-disabled")).toBe("true");
    expect(photos.textContent).toContain("acme/text-only can’t read images.");
    const files = await ui.findByRole("menuitem", { name: /Add files/ });
    expect(files.getAttribute("aria-disabled")).not.toBe("true");
    pick(ui, [file("a.png", "image/png"), file("b.txt", "text/plain")]);
    expect(calls.map((c) => c.file.name)).toEqual(["b.txt"]);
    expect(ui.getByRole("alert").textContent).toContain("can’t read images");
  }));
test("switching to a model that cannot read an attached image turns Send off with the reason", () =>
  withAnimationFrames(async () => {
    const image = {
      id: "img1",
      filename: "cat.png",
      kind: "image" as const,
      contentType: "image/png",
      size: 10,
    };
    const props = {
      chatId: "switch",
      initialAttachments: [image],
      upload: fakeUploader().upload,
      onSend: async () => true,
      onStop: () => {},
    };
    const ui = render(<Composer {...props} model="acme/text-only" />);
    const send = () =>
      ui.getByRole("button", { name: "Send message" }) as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    expect(ui.getByRole("status").textContent).toContain(
      "acme/text-only can’t read images. Remove “cat.png” or choose another model",
    );
    fireEvent.change(ui.getByRole("textbox"), { target: { value: "Hi" } });
    expect(send().disabled).toBe(true);

    // Removing the file lets the Message go.
    fireEvent.click(ui.getByRole("button", { name: "Remove cat.png" }));
    expect(send().disabled).toBe(false);
    expect(ui.queryByRole("status")).toBeNull();
  }));

test("User Messages show image thumbnails that open larger, and chips for other files", async () => {
  const ui = render(
    <Message
      message={{
        ...message,
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            filename: "cat.png",
            url: "/api/attachments/img1",
          },
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "plan.pdf",
            url: "/api/attachments/pdf1",
          },
          { type: "text", text: "Look" },
        ],
      }}
      busy={false}
      streaming={false}
      onEdit={() => true}
      onRegenerate={() => {}}
      onContinue={() => {}}
      onSwitch={() => {}}
    />,
  );
  const thumbnail = ui.getByRole("img", { name: "cat.png" });
  expect(thumbnail.getAttribute("src")).toBe("/api/attachments/img1");
  const chip = ui.getByRole("link", { name: "plan.pdf" });
  expect(chip.getAttribute("href")).toBe("/api/attachments/pdf1");
  expect(chip.getAttribute("rel")).toContain("noopener");
});

test("a thumbnail opens a larger view", () =>
  withAnimationFrames(async () => {
    const { MessageAttachments } = await import(
      "../../components/chat/message-attachments"
    );
    const ui = render(
      <MessageAttachments
        parts={[
          {
            type: "file",
            mediaType: "image/png",
            filename: "cat.png",
            url: "/api/attachments/img1",
          },
        ]}
      />,
    );
    fireEvent.click(ui.getByRole("button", { name: "Open cat.png" }));
    const dialog = await ui.findByRole("dialog");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
      "/api/attachments/img1",
    );
  }));
