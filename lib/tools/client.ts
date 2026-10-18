import type { SelectedRevision, ToolRunRequest, ToolRunView } from "./contract";
export type ToolCatalog = {
  models: {
    id: string;
    name: string;
    funding: "openrouter" | "gateway";
    estimateMicrodollars: number;
  }[];
  credentials: { provider: string; testState: string }[];
  revisions: (SelectedRevision & { title: string })[];
};
export type ToolClient = {
  catalog: () => Promise<ToolCatalog>;
  run: (request: ToolRunRequest, signal: AbortSignal) => Promise<ToolRunView>;
  view: (id: string) => Promise<ToolRunView>;
  remove: (id: string) => Promise<void>;
};
async function response<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error("tools_request_failed");
  return res.json();
}
export const toolClient: ToolClient = {
  catalog: async () =>
    response(await fetch("/api/tools", { cache: "no-store" })),
  run: async (request, signal) =>
    response(
      await fetch("/api/tools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run", request }),
        signal,
      }),
    ),
  view: async (id) =>
    response(
      await fetch(`/api/tools?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      }),
    ),
  remove: async (id) => {
    await response(
      await fetch("/api/tools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      }),
    );
  },
};
