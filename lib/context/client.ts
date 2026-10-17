import type { ContextLibrary, ContextSelection, ContextView } from "./contract";
export type ContextClient = {
  library: (signal?: AbortSignal) => Promise<ContextLibrary>;
  preview: (
    selection: ContextSelection,
    signal?: AbortSignal,
  ) => Promise<ContextView>;
  mutate: (body: unknown) => Promise<void>;
};
async function read(response: Response) {
  if (!response.ok) throw new Error("context_failed");
  return response.json();
}
export const contextClient: ContextClient = {
  library: async (signal) =>
    read(await fetch("/api/context", { cache: "no-store", signal })),
  preview: async (selection, signal) =>
    read(
      await fetch("/api/context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "preview", selection }),
        signal,
      }),
    ),
  mutate: async (body) => {
    await read(
      await fetch("/api/context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  },
};
