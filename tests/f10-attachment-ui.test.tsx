import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, type ReactNode, useCallback, useState } from "react";
import { AttachmentComposer } from "../components/chat/attachment-composer";
import type { AttachmentClient } from "../lib/attachments/client";
import type {
  AttachmentSelection,
  AttachmentView,
} from "../lib/attachments/contract";

const chatId = "10000000-0000-4000-8000-000000000001";
function file(id: string, kind: "text" | "image" = "text"): AttachmentView {
  return {
    id,
    chatId,
    name: `${id}.${kind === "image" ? "png" : "txt"}`,
    mediaType: kind === "image" ? "image/png" : "text/plain",
    kind,
    bytes: 4,
    state: "ready",
    pages: null,
    extractedCharacters: kind === "text" ? 4 : 0,
    createdAt: "2026-10-17T00:00:00Z",
  };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function dom() {
  const window = new Window();
  const values = {
    window,
    document: window.document,
    Event: window.Event,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = Object.entries(values).map(([name, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
    return { name, descriptor };
  });
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return {
    container,
    render: async (node: ReactNode) => {
      await act(async () => root.render(node));
    },
    click: async (node: HTMLElement) => {
      await act(async () => node.click());
    },
    changeFile: async (next: File) => {
      const input = container.querySelector('input[type="file"]');
      if (!input) throw new Error("fixture_missing_file_input");
      Object.defineProperty(input, "files", {
        value: [next],
        configurable: true,
      });
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    },
    close: async () => {
      await act(async () => root.unmount());
      await window.happyDOM.close();
      for (const { name, descriptor } of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}
function button(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (node) =>
      node.getAttribute("aria-label") === label ||
      node.textContent?.trim() === label,
  );
  if (!found) throw new Error(`fixture_missing_button:${label}`);
  return found;
}
function checkbox(container: HTMLElement, name: string) {
  const label = [...container.querySelectorAll("label")].find((node) =>
    node.textContent?.includes(name),
  );
  const input = label?.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  if (!input) throw new Error(`fixture_missing_checkbox:${name}`);
  return input;
}
function clientFor(
  files: AttachmentView[],
  remove: AttachmentClient["remove"],
  upload: AttachmentClient["upload"],
): AttachmentClient {
  return {
    list: async () => files,
    downloadURL: (id) => `#fixture-${id}`,
    remove,
    upload,
    preview: async (input) => {
      const selected = files.filter((f) => input.ids.includes(f.id));
      if (input.model === "text" && selected.some((f) => f.kind === "image"))
        throw new Error("attachment_model_unsupported");
      return {
        digest: "f".repeat(64),
        estimatedTokens: 100,
        imageTokens: selected.some((f) => f.kind === "image") ? 4096 : 0,
        provenance: selected.map((f) => ({
          id: f.id,
          name: f.name,
          kind: f.kind,
          pages: null,
          sha256: "f".repeat(64),
        })),
        excerpts: selected.map((f) => ({ id: f.id, text: "data" })),
      };
    },
  };
}
function Harness({ client }: { client: AttachmentClient }) {
  const [images, setImages] = useState(true);
  const [selection, setSelection] = useState<AttachmentSelection>();
  const [ready, setReady] = useState(false);
  const onChange = useCallback(
    (next: AttachmentSelection | undefined, nextReady: boolean) => {
      setSelection(next);
      setReady(nextReady);
    },
    [],
  );
  return (
    <>
      <button type="button" onClick={() => setImages((value) => !value)}>
        Switch model
      </button>
      <AttachmentComposer
        chatId={chatId}
        saved
        temporary={false}
        busy={false}
        contextReady
        model={images ? "image" : "text"}
        funding="openrouter"
        imagesSupported={images}
        client={client}
        onChange={onChange}
      />
      <output data-testid="selection">
        {selection?.ids.join(",") ?? "none"}
      </output>
      <button type="button" disabled={!ready}>
        Send fixture
      </button>
    </>
  );
}

test("F10 real composer serializes immediate double deletes and never restores selection changed during the deferred delete", async () => {
  const ui = await dom();
  const a = file("A"),
    b = file("B"),
    image = file("C", "image");
  const first = deferred<void>(),
    second = deferred<void>();
  const calls: string[] = [];
  const client = clientFor(
    [a, b, image],
    async (id) => {
      calls.push(id);
      await (id === a.id ? first.promise : second.promise);
    },
    async () => {
      throw new Error("unused_upload");
    },
  );
  try {
    await ui.render(<Harness client={client} />);
    for (const f of [a, b, image])
      await ui.click(checkbox(ui.container, f.name));
    expect(button(ui.container, "Send fixture").disabled).toBe(false);
    const deleteA = button(ui.container, `Delete ${a.name}`),
      deleteB = button(ui.container, `Delete ${b.name}`);
    await act(async () => {
      deleteA.click();
      deleteA.click();
      deleteB.click();
    });
    expect(calls).toEqual([a.id]);
    expect(deleteA.disabled).toBe(true);
    expect(deleteB.disabled).toBe(true);
    expect(deleteA.getAttribute("aria-busy")).toBe("true");
    expect(deleteA.getAttribute("aria-label")).toBe(`Delete ${a.name}`);
    expect(deleteA.querySelector("svg.animate-spin")).not.toBeNull();
    expect(button(ui.container, "Send fixture").disabled).toBe(true);
    // This input stays interactive while a different file is being deleted.
    await ui.click(checkbox(ui.container, b.name));
    await ui.click(button(ui.container, "Switch model"));
    await act(async () => first.resolve());
    expect(calls).toEqual([a.id]);
    expect(ui.container.textContent).not.toContain(a.name);
    expect(checkbox(ui.container, b.name).checked).toBe(false);
    expect(checkbox(ui.container, image.name).checked).toBe(true);
    expect(ui.container.textContent).toContain("This model cannot read images");
    expect(button(ui.container, "Send fixture").disabled).toBe(true);
    await ui.click(checkbox(ui.container, image.name));
    expect(button(ui.container, "Send fixture").disabled).toBe(false);
    await ui.click(checkbox(ui.container, b.name));
    expect(
      ui.container.querySelector('[data-testid="selection"]')?.textContent,
    ).toBe(b.id);
    await ui.click(button(ui.container, `Delete ${b.name}`));
    await act(async () => second.resolve());
    expect(calls).toEqual([a.id, b.id]);
    expect(ui.container.textContent).not.toContain(b.name);
    expect(
      ui.container.querySelector('[data-testid="selection"]')?.textContent,
    ).toBe("none");
    expect(button(ui.container, "Send fixture").disabled).toBe(false);
  } finally {
    first.resolve();
    second.resolve();
    await ui.close();
  }
});

test("F10 real upload keeps its action label and cancellation usable, and uses the model capability current at completion", async () => {
  const ui = await dom();
  const image = file("image", "image");
  const staged = deferred<AttachmentView>();
  let calls = 0;
  let signal: AbortSignal | undefined;
  const client = clientFor(
    [],
    async () => {},
    async (_chat, _file, nextSignal) => {
      calls++;
      signal = nextSignal;
      return new Promise((resolve, reject) => {
        nextSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
        if (calls === 1) void staged.promise.then(resolve, reject);
      });
    },
  );
  try {
    await ui.render(<Harness client={client} />);
    await ui.changeFile(new File(["data"], "image.png", { type: "image/png" }));
    const add = button(ui.container, "Add file");
    expect(add.getAttribute("aria-busy")).toBe("true");
    expect(add.disabled).toBe(true);
    expect(add.querySelector("svg.animate-spin")).not.toBeNull();
    expect(button(ui.container, "Cancel upload").disabled).toBe(false);
    await ui.click(button(ui.container, "Switch model"));
    await act(async () => staged.resolve(image));
    expect(checkbox(ui.container, image.name).checked).toBe(false);
    expect(checkbox(ui.container, image.name).disabled).toBe(true);
    expect(add.getAttribute("aria-busy")).toBe("false");
    expect(ui.container.textContent).toContain("This model cannot read images");
    await ui.changeFile(
      new File(["data"], "cancel.txt", { type: "text/plain" }),
    );
    expect(calls).toBe(2);
    expect(add.getAttribute("aria-busy")).toBe("true");
    await ui.click(button(ui.container, "Cancel upload"));
    expect(signal?.aborted).toBe(true);
    expect(add.getAttribute("aria-busy")).toBe("false");
    expect(add.disabled).toBe(false);
    expect(ui.container.textContent).toContain("Upload cancelled");
    expect(button(ui.container, "Send fixture").disabled).toBe(false);
  } finally {
    staged.resolve(image);
    await ui.close();
  }
});
