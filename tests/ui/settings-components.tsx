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
  "requestAnimationFrame",
  "cancelAnimationFrame",
])
  Object.defineProperty(globalThis, key, {
    value:
      key === "window"
        ? browser
        : (browser as unknown as Record<string, unknown>)[key],
    configurable: true,
    writable: true,
  });
const { render, fireEvent, cleanup, waitFor, act } = await import(
  "@testing-library/react"
);
const { Personalization } = await import(
  "../../components/settings/personalization"
);
const { ArchivedChats } = await import(
  "../../components/settings/archived-chats"
);

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

test("Save instructions stays disabled until a value differs from the saved one", () => {
  const ui = render(
    <Personalization
      saved={{ aboutYou: "Astronomer", responseInstructions: "" }}
      onSaved={() => {}}
    />,
  );
  const save = ui.getByRole("button", {
    name: "Save instructions",
  }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  const about = ui.getByLabelText("About you");
  fireEvent.change(about, { target: { value: "Astronomer and cook" } });
  expect(save.disabled).toBe(false);
  fireEvent.change(about, { target: { value: "Astronomer" } });
  expect(save.disabled).toBe(true);
});

test("the character counter appears at 1,800 of 2,000 characters", () => {
  const ui = render(
    <Personalization
      saved={{ aboutYou: "", responseInstructions: "" }}
      onSaved={() => {}}
    />,
  );
  const about = ui.getByLabelText("About you");
  fireEvent.change(about, { target: { value: "a".repeat(1799) } });
  expect(ui.queryByText("1,799 / 2,000")).toBeNull();
  fireEvent.change(about, { target: { value: "a".repeat(1800) } });
  expect(ui.getByText("1,800 / 2,000")).not.toBeNull();
});

function renderArchived(deleted: string[], calls: string[]) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return render(
    <ArchivedChats
      chats={[{ id: "c1", title: "Old Chat" }]}
      hasMore={false}
      onRestored={async () => {}}
      onDeleted={async (id) => {
        deleted.push(id);
      }}
      onLoadMore={async () => {}}
    />,
  );
}

test("deleting an archived Chat asks first, and Cancel deletes nothing", async () => {
  const calls: string[] = [];
  const deleted: string[] = [];
  const ui = renderArchived(deleted, calls);
  fireEvent.click(ui.getByRole("button", { name: "Delete" }));
  const dialog = await waitFor(() => ui.getByRole("alertdialog"));
  expect(dialog.textContent).toContain("Delete this Chat?");
  expect(calls).toEqual([]);
  fireEvent.click(ui.getByRole("button", { name: "Cancel" }));
  await act(async () => {});
  expect(calls).toEqual([]);
  expect(deleted).toEqual([]);
});

test("confirming Delete Chat deletes the Chat", async () => {
  const calls: string[] = [];
  const deleted: string[] = [];
  const ui = renderArchived(deleted, calls);
  fireEvent.click(ui.getByRole("button", { name: "Delete" }));
  await waitFor(() => ui.getByRole("alertdialog"));
  expect(calls).toEqual([]);
  fireEvent.click(ui.getByRole("button", { name: "Delete Chat" }));
  await waitFor(() => expect(deleted).toEqual(["c1"]));
  expect(calls).toEqual(["DELETE /api/chats/c1"]);
});
