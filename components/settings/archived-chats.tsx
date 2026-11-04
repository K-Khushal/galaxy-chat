"use client";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorCopy } from "@/components/chat/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState, InlineAlert } from "@/components/ui/state";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SettingsGroup, SettingsList } from "./settings-group";

export type ArchivedChat = { id: string; title: string | null };

export function ArchivedChats({
  chats,
  hasMore,
  onRestored,
  onDeleted,
  onLoadMore,
}: {
  chats: ArchivedChat[];
  hasMore: boolean;
  /** Called after the server accepted the change, with the Chat's ID. */
  onRestored: (id: string) => Promise<void>;
  onDeleted: (id: string) => Promise<void>;
  onLoadMore: () => Promise<void>;
}) {
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [restoreFailure, setRestoreFailure] = useState("");
  const [deleteFailure, setDeleteFailure] = useState("");

  async function restore(id: string) {
    setRestoring(id);
    setRestoreFailure("");
    try {
      await api(`/api/chats/${id}`, { archived: false }, "PATCH");
      await onRestored(id);
      toast.success("Chat restored.");
    } catch (error) {
      setRestoreFailure(errorCopy(error as Error));
    } finally {
      setRestoring(null);
    }
  }
  async function remove(id: string) {
    setDeleting(true);
    setDeleteFailure("");
    try {
      await api(`/api/chats/${id}`, {}, "DELETE");
      setConfirming(null);
      await onDeleted(id);
      toast.success("Chat deleted.");
    } catch (error) {
      setDeleteFailure(errorCopy(error as Error));
    } finally {
      setDeleting(false);
    }
  }
  async function loadMore() {
    setLoadingMore(true);
    try {
      await onLoadMore();
    } catch (error) {
      toast.error(errorCopy(error as Error), {
        action: { label: "Try again", onClick: () => void loadMore() },
      });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <SettingsGroup title="Archived chats">
        {restoreFailure ? (
          <div className="p-3">
            <InlineAlert tone="error">{restoreFailure}</InlineAlert>
          </div>
        ) : null}
        <SettingsList
          className={chats.length ? "divide-y" : "grid place-items-center px-4"}
        >
          {chats.length ? (
            chats.map((chat) => (
              <div
                key={chat.id}
                className="flex min-h-14 items-center gap-2 px-4 py-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {chat.title ?? "Untitled chat"}
                </span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Unarchive"
                        pending={restoring === chat.id}
                        disabled={restoring !== null}
                        onClick={() => void restore(chat.id)}
                      />
                    }
                  >
                    <ArchiveRestore />
                  </TooltipTrigger>
                  <TooltipContent>Unarchive</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete"
                        className="text-destructive"
                        disabled={restoring !== null}
                        onClick={() => setConfirming(chat.id)}
                      />
                    }
                  >
                    <Trash2 />
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              </div>
            ))
          ) : (
            <EmptyState size="inline" title="No archived chats" />
          )}
          {hasMore ? (
            <Button
              variant="ghost"
              className="h-11 w-full rounded-none"
              pending={loadingMore}
              onClick={() => void loadMore()}
            >
              Load more
            </Button>
          ) : null}
        </SettingsList>
      </SettingsGroup>
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (open || deleting) return;
          setConfirming(null);
          setDeleteFailure("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the Chat and its Messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteFailure ? (
            <InlineAlert tone="error">{deleteFailure}</InlineAlert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              pending={deleting}
              onClick={() => confirming && void remove(confirming)}
            >
              Delete Chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
