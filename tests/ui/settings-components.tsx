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
const { OpenRouterKey } = await import(
  "../../components/settings/openrouter-key"
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

function failWith(error: string, status = 500) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error }), {
      status,
    })) as unknown as typeof fetch;
}

test("a failed save shows an alert in the card, not a toast, and keeps the draft", async () => {
  failWith("connection_failed");
  let saved = false;
  const ui = render(
    <Personalization
      saved={{ aboutYou: "", responseInstructions: "" }}
      onSaved={() => {
        saved = true;
      }}
    />,
  );
  fireEvent.change(ui.getByLabelText("About you"), {
    target: { value: "Astronomer" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Save instructions" }));
  const alert = await waitFor(() => ui.getByRole("alert"));
  expect(alert.textContent).toContain("Something went wrong");
  expect(saved).toBe(false);
  expect((ui.getByLabelText("About you") as HTMLTextAreaElement).value).toBe(
    "Astronomer",
  );
  // Editing clears the stale failure.
  fireEvent.change(ui.getByLabelText("About you"), {
    target: { value: "Astronomer and cook" },
  });
  expect(ui.queryByRole("alert")).toBeNull();
});

test("an over-long field shows its error below the field and sends nothing", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  const ui = render(
    <Personalization
      saved={{ aboutYou: "", responseInstructions: "" }}
      onSaved={() => {}}
    />,
  );
  const about = ui.getByLabelText("About you");
  fireEvent.change(about, { target: { value: "a".repeat(2001) } });
  // Submit the form directly: the browser's own maxLength check is not the subject.
  fireEvent.submit(about.closest("form") as HTMLFormElement);
  await waitFor(() =>
    expect(ui.getByText("Keep this under 2,000 characters.")).not.toBeNull(),
  );
  expect(about.getAttribute("aria-invalid")).toBe("true");
  expect(ui.queryByRole("alert")).toBeNull();
  expect(calls).toEqual([]);
  // Fixing the field clears its error without another submit.
  fireEvent.change(about, { target: { value: "a".repeat(2000) } });
  await waitFor(() =>
    expect(ui.queryByText("Keep this under 2,000 characters.")).toBeNull(),
  );
});

test("a rejected key test shows an alert in the OpenRouter key card", async () => {
  failWith("provider_key_rejected", 400);
  const ui = render(
    <OpenRouterKey
      saved={{ updatedAt: "2026-01-02T00:00:00Z" }}
      onChanged={async () => {}}
    />,
  );
  fireEvent.click(ui.getByRole("button", { name: "Test key" }));
  const alert = await waitFor(() => ui.getByRole("alert"));
  expect(alert.textContent).toContain("OpenRouter did not accept this key");
  // The title is not repeated as the row title.
  expect(ui.getAllByText("OpenRouter key")).toHaveLength(1);
});

test("a failed unarchive shows an alert in the card and keeps the Chat listed", async () => {
  failWith("connection_failed");
  const ui = renderArchived([], []);
  failWith("connection_failed");
  fireEvent.click(ui.getByRole("button", { name: "Unarchive" }));
  const alert = await waitFor(() => ui.getByRole("alert"));
  expect(alert.textContent).toContain("Something went wrong");
  expect(ui.getByText("Old Chat")).not.toBeNull();
});

test("a failed delete shows the alert inside the confirmation, which stays open", async () => {
  const ui = renderArchived([], []);
  failWith("connection_failed");
  fireEvent.click(ui.getByRole("button", { name: "Delete" }));
  await waitFor(() => ui.getByRole("alertdialog"));
  fireEvent.click(ui.getByRole("button", { name: "Delete Chat" }));
  const alert = await waitFor(() => ui.getByRole("alert"));
  expect(ui.getByRole("alertdialog").contains(alert)).toBe(true);
});
