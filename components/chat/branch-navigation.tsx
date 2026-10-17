"use client";
import { Button } from "@/components/ui/button";
export type BranchOption = {
  id: string;
  label: string;
  parentId: string | null;
};
export function BranchNavigation({
  branches,
  branchId,
  busy,
  syncing,
  state,
  onSelect,
  onReload,
  onRetry,
  retryEnabled,
}: {
  branches: BranchOption[];
  branchId: string;
  busy: boolean;
  syncing: boolean;
  state?: string;
  onSelect: (id: string) => void;
  onReload: () => void;
  onRetry: () => void;
  retryEnabled: boolean;
}) {
  if (!branches.length) return null;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-5 py-2 text-xs text-muted-foreground">
      <label htmlFor="conversation-branch">Conversation branch</label>
      <select
        id="conversation-branch"
        value={branchId}
        disabled={busy || syncing}
        className="max-w-full rounded-md border border-border bg-background px-2 py-2 text-base focus-visible:outline-ring md:text-sm"
        onChange={(event) => onSelect(event.target.value)}
      >
        {branches.map((branch, index) => (
          <option key={branch.id} value={branch.id}>
            {index + 1}. {branch.label}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || syncing}
        onClick={onReload}
      >
        Reload saved
      </Button>
      {(state === "error" || state === "stopped") && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy || syncing || !retryEnabled}
          onClick={onRetry}
        >
          Retry in new branch
        </Button>
      )}
      <output aria-live="polite">
        {syncing
          ? "Loading saved messages…"
          : state === "stopped"
            ? "Response stopped"
            : state === "error"
              ? "Response did not complete"
              : state === "pending"
                ? "Saved request is awaiting reconciliation"
                : ""}
      </output>
    </div>
  );
}
