import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { imageFixtureSnapshot } from "../components/artifacts/image-fixture";
import {
  type ImageClient,
  ImageComposer,
  ImageEditor,
} from "../components/artifacts/image-workbench";
import type { ArtifactDocument } from "../lib/artifacts/contract";

const catalog = {
  available: true,
  model: imageFixtureSnapshot,
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
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
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
