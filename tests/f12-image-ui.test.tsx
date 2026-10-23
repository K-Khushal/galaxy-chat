import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ImageFixture,
  imageFixtureSnapshot,
} from "../components/artifacts/image-fixture";
import {
  type ImageClient,
  ImageComposer,
  ImageEditor,
} from "../components/artifacts/image-workbench";
import type { ArtifactDocument } from "../lib/artifacts/contract";

const catalog = {
  available: true,
  model: imageFixtureSnapshot,
  reviewDigest: "0".repeat(64),
  credentialRevision: "10000000-0000-4000-8000-000000000001",
};
const doc: ArtifactDocument = {
  id: "image-id",
  chatId: "chat",
  messageId: "answer",
  kind: "image",
  title: "<script>private</script>",
  version: 2,
  content: "{}",
  updatedAt: "2026-10-22",
  revisions: [
    {
      version: 2,
      title: "Second",
      restoredFrom: null,
      createdAt: "2026-10-22",
    },
    { version: 1, title: "First", restoredFrom: null, createdAt: "2026-10-22" },
  ],
};
const artifacts = {
  list: async () => [],
  read: async () => doc,
  mutate: async () => ({ id: doc.id }),
};
test("F12-C generation UI requires an explicit action and names payer, limits, expiry, cost uncertainty and denied editing", () => {
  const html = renderToStaticMarkup(
    <ImageComposer
      catalog={catalog}
      chatId="chat"
      messageId="answer"
      title="Image"
      onSaved={() => {}}
    />,
  );
  for (const text of [
    imageFixtureSnapshot.model,
    imageFixtureSnapshot.provider,
    imageFixtureSnapshot.expiresAt,
    "Your OpenRouter key",
    "1024",
    "4 MiB",
    "0.120000",
    "Application ceiling (USD)",
    "does not cap",
    "provider spending",
    "Editing and masks are unavailable",
    "Generate image",
    'disabled=""',
    'aria-live="polite"',
  ])
    expect(html).toContain(text);
  expect(
    renderToStaticMarkup(
      <ImageComposer
        catalog={{ available: false }}
        chatId="chat"
        messageId="answer"
        title="Image"
        onSaved={() => {}}
      />,
    ),
  ).toBe("");
});
test("F12-C image editor has an authenticated explicit-revision preview/download and no source editor", () => {
  const html = renderToStaticMarkup(
    <ImageEditor
      document={doc}
      api={artifacts}
      onChange={() => {}}
      onDeleted={() => {}}
    />,
  );
  expect(html).toContain("/api/images/object?id=image-id&amp;version=2");
  expect(html).toContain("Download revision 2 PNG");
  expect(html).toContain("Generated image:");
  expect(html).toContain("Restore as new revision");
  expect(html).toContain("Saved image revision");
  expect(html).not.toContain("<textarea");
  expect(html).not.toContain("<script>");
  const fixture = renderToStaticMarkup(
    <ImageEditor
      document={doc}
      api={artifacts}
      onChange={() => {}}
      onDeleted={() => {}}
      fixture
    />,
  );
  expect(fixture).toContain("No provider output or private-storage");
  expect(fixture).not.toContain("<img");
  expect(fixture).not.toContain("href=");
});
test("F12-C recent request controls use the selected id and report held state without dispatching", async () => {
  const window = new Window();
  const globals = {
    window,
    document: window.document,
    Event: window.Event,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = Object.entries(globals).map(([name, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
    return { name, descriptor };
  });
  let seen = "",
    generated = 0;
  const api: ImageClient = {
    catalog: async () => catalog,
    generate: async () => {
      generated++;
      return { id: "never", version: 1 };
    },
    status: async (id) => {
      seen = id;
      return { id, state: "held", cancelled: false, artifactId: null };
    },
    cancel: async () => {
      throw Error("never");
    },
  };
  const { createRoot } = await import("react-dom/client");
  const container = window.document.createElement("div");
  window.document.body.append(container);
  // React createRoot requires a DOM-typed Container; container itself stays in the HappyDOM realm for element queries.
  const root = createRoot(container as unknown as HTMLElement);
  try {
    await act(async () =>
      root.render(
        <ImageComposer
          catalog={{
            ...catalog,
            recent: [
              {
                id: "recent-image-id",
                state: "held",
                cancelled: false,
                artifactId: null,
              },
            ],
          }}
          chatId="chat"
          messageId="answer"
          title="Image"
          onSaved={() => {}}
          api={api}
        />,
      ),
    );
    const check = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Check recent-i"),
    );
    expect(check).toBeDefined();
    await act(async () => check?.click());
    expect(seen).toBe("recent-image-id");
    expect(container.textContent).toContain("Provider outcome held");
    expect(generated).toBe(0);
    expect(container.querySelector("output")?.classList.contains("block")).toBe(
      true,
    );
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const { name, descriptor } of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("F12-C composer echoes catalog review digest and blocks dispatch without it", async () => {
  const window = new Window();
  const globals = {
    window,
    document: window.document,
    Event: window.Event,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLButtonElement: window.HTMLButtonElement,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = Object.entries(globals).map(([name, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
    return { name, descriptor };
  });

  const testDigest =
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  let receivedInput: Parameters<ImageClient["generate"]>[0] | undefined;
  const api: ImageClient = {
    catalog: async () => ({ ...catalog, reviewDigest: testDigest }),
    generate: async (input) => {
      receivedInput = input;
      return { id: "test-gen-id", version: 1 };
    },
    status: async (id) => ({
      id,
      state: "complete",
      cancelled: false,
      artifactId: "test-gen-id",
    }),
    cancel: async (id) => ({
      id,
      state: "cancelled",
      cancelled: true,
      artifactId: null,
    }),
  };

  const { createRoot } = await import("react-dom/client");
  const container = window.document.createElement("div");
  window.document.body.append(container);
  // React createRoot requires a DOM-typed Container; container itself stays in the HappyDOM realm for element queries.
  const root = createRoot(container as unknown as HTMLElement);
  try {
    // 1. Without reviewDigest, Generate button is disabled
    await act(async () => {
      root.render(
        <ImageComposer
          catalog={{
            available: true,
            model: imageFixtureSnapshot,
            credentialRevision: "10000000-0000-4000-8000-000000000001",
          }}
          chatId="chat"
          messageId="answer"
          title="Image"
          onSaved={() => {}}
          api={api}
        />,
      );
    });
    const generateBtnNoDigest = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Generate image"),
    );
    if (!(generateBtnNoDigest instanceof window.HTMLButtonElement))
      throw new Error("fixture_missing_generate_button");
    expect(generateBtnNoDigest.hasAttribute("disabled")).toBe(true);

    // 2. With catalog reviewDigest, fill required fields, click generate, verify propagated digest
    await act(async () => {
      root.render(
        <ImageComposer
          catalog={{
            ...catalog,
            reviewDigest: testDigest,
          }}
          chatId="chat"
          messageId="answer"
          title="Image"
          onSaved={() => {}}
          api={api}
        />,
      );
    });

    const textarea = container.querySelector("textarea");
    if (!(textarea instanceof window.HTMLTextAreaElement))
      throw new Error("fixture_missing_textarea");
    const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (!nativeTextareaSetter)
      throw new Error("fixture_missing_textarea_setter");
    await act(async () => {
      nativeTextareaSetter.call(textarea, "A test prompt");
      textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
      textarea.dispatchEvent(new window.Event("change", { bubbles: true }));
    });

    const checkbox = container.querySelector('input[type="checkbox"]');
    if (!(checkbox instanceof window.HTMLInputElement))
      throw new Error("fixture_missing_checkbox");
    await act(async () => {
      checkbox.click();
    });

    const generateBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Generate image"),
    );
    if (!(generateBtn instanceof window.HTMLButtonElement))
      throw new Error("fixture_missing_generate_button");
    expect(generateBtn.hasAttribute("disabled")).toBe(false);

    await act(async () => {
      generateBtn.click();
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    if (!receivedInput) throw new Error("fixture_generate_not_called");
    expect(receivedInput.reviewDigest).toBe(testDigest);
    expect(receivedInput.modelId).toBe(imageFixtureSnapshot.id);
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const { name, descriptor } of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("F12-C ImageFixture enables local generate with valid prompt and ack, reaches fake editor, and held simulation keeps outcome held without revision", async () => {
  const window = new Window();
  const globals = {
    window,
    document: window.document,
    Event: window.Event,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLButtonElement: window.HTMLButtonElement,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = Object.entries(globals).map(([name, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
    return { name, descriptor };
  });

  const { createRoot } = await import("react-dom/client");
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);

  try {
    await act(async () => {
      root.render(<ImageFixture />);
    });

    const textarea = container.querySelector("textarea");
    if (!(textarea instanceof window.HTMLTextAreaElement))
      throw new Error("fixture_missing_textarea");
    const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (!nativeTextareaSetter)
      throw new Error("fixture_missing_textarea_setter");

    const heldCheckbox = [
      ...container.querySelectorAll('input[type="checkbox"]'),
    ].find((c) =>
      c.parentElement?.textContent?.includes(
        "Simulate an unknown provider outcome",
      ),
    );
    if (!(heldCheckbox instanceof window.HTMLInputElement))
      throw new Error("fixture_missing_held_checkbox");

    const ackCheckbox = [
      ...container.querySelectorAll('input[type="checkbox"]'),
    ].find((c) =>
      c.parentElement?.textContent?.includes("OpenRouter key pays"),
    );
    if (!(ackCheckbox instanceof window.HTMLInputElement))
      throw new Error("fixture_missing_ack_checkbox");

    const generateBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Generate local fixture"),
    );
    if (!(generateBtn instanceof window.HTMLButtonElement))
      throw new Error("fixture_missing_generate_button");

    // 1. Initially disabled before prompt and ack
    expect(generateBtn.hasAttribute("disabled")).toBe(true);

    // 2. Enable held simulation, enter valid prompt, check ack -> button enables
    await act(async () => {
      heldCheckbox.click();
      nativeTextareaSetter.call(textarea, "Imaginary planet landscape");
      textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
      textarea.dispatchEvent(new window.Event("change", { bubbles: true }));
      ackCheckbox.click();
    });
    expect(generateBtn.hasAttribute("disabled")).toBe(false);

    // 3. Dispatch with unknown outcome simulation: request stays held, no revision saved, editor not reached
    await act(async () => {
      generateBtn.click();
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(container.textContent).toContain(
      "The provider outcome is unknown. This request stays held",
    );
    expect(container.textContent).not.toContain("New fixture image");
    expect(container.textContent).not.toContain("Image revision 1");

    // 4. Uncheck held simulation, click generate again -> succeeds and reaches fake image editor with revision 1
    await act(async () => {
      heldCheckbox.click();
    });
    const generateBtnRetry = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Generate local fixture"),
    );
    if (!(generateBtnRetry instanceof window.HTMLButtonElement))
      throw new Error("fixture_missing_generate_button_retry");

    await act(async () => {
      generateBtnRetry.click();
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(container.textContent).toContain("New fixture image");
    expect(container.textContent).toContain("Image revision 1");
    expect(container.textContent).toContain("Saved image revision");
    expect(container.textContent).toContain(
      "Revision 1 — Quiet evening on an imaginary planet",
    );
    expect(container.textContent).toContain("Download PNG");
    expect(container.textContent).toContain(
      "No provider output or private-storage proof",
    );
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const { name, descriptor } of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
