"use client";
import {
  Download,
  Loader2,
  Palette,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  ProviderSettings,
  type ProviderSettingsClient,
} from "@/components/provider-settings";
import { SearchProviderSettings } from "@/components/search/search-provider-settings";
import { CreditNotice } from "@/components/shell/credit-notice";
import { ThemeControl } from "@/components/shell/theme-control";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth/client";
import type { TypeUserProfile } from "@/lib/types";
export type AccountActions = {
  deleteAccount: () => Promise<void> | void;
  exportData: () => Promise<void> | void;
  signOut?: () => void;
};
export function SettingsDialog({
  open,
  setOpen,
  user,
  actions,
  initialTab = "profile",
  onCloseFocus,
  providerClient,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  user: TypeUserProfile;
  actions?: AccountActions;
  initialTab?: string;
  onCloseFocus?: () => void;
  providerClient?: ProviderSettingsClient;
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteOpener = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<"export" | "delete" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  async function downloadExport() {
    if (pending) return;
    setPending("export");
    setFailure(null);
    try {
      if (actions) await actions.exportData();
      else {
        const response = await fetch("/api/account/export");
        if (!response.ok) throw new Error("Export failed");
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "galaxy-chat-export.json";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success("Export downloaded");
      }
    } catch {
      setFailure("Your export could not be downloaded. Please try again.");
    } finally {
      setPending(null);
    }
  }
  async function removeAccount() {
    if (pending) return;
    setPending("delete");
    setFailure(null);
    try {
      if (actions) {
        await actions.deleteAccount();
        setConfirmDelete(false);
        setOpen(false);
      } else {
        const response = await fetch("/api/account", { method: "DELETE" });
        if (!response.ok) throw new Error("Delete failed");
        await authClient.signOut();
        router.replace("/sign-in?notice=unauthenticated");
      }
    } catch {
      setFailure(
        "Your account could not be deleted. No confirmation was received. Please try again.",
      );
    } finally {
      setPending(null);
    }
  }
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <DialogContent
          className="gap-6 sm:max-w-xl"
          onCloseAutoFocus={(event) => {
            if (onCloseFocus) {
              event.preventDefault();
              onCloseFocus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Account & settings</DialogTitle>
            <DialogDescription>
              Your workspace, appearance, and data controls.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue={initialTab}>
            <TabsList className="mb-5 grid h-auto w-full grid-cols-4 bg-muted p-1">
              <TabsTrigger
                value="profile"
                className="min-h-11 gap-2 px-1 text-xs sm:px-2 sm:text-sm"
              >
                <UserRound className="hidden size-4 sm:block" />
                Account
              </TabsTrigger>
              <TabsTrigger
                value="appearance"
                className="min-h-11 gap-2 px-1 text-xs sm:px-2 sm:text-sm"
              >
                <Palette className="hidden size-4 sm:block" />
                Appearance
              </TabsTrigger>
              <TabsTrigger
                value="security"
                className="min-h-11 gap-2 px-1 text-xs sm:px-2 sm:text-sm"
              >
                <ShieldCheck className="hidden size-4 sm:block" />
                Privacy
              </TabsTrigger>
              <TabsTrigger
                value="providers"
                className="min-h-11 px-1 text-xs sm:px-2 sm:text-sm"
              >
                Keys
              </TabsTrigger>
            </TabsList>
            <TabsContent value="profile" className="space-y-6">
              <div className="rounded-xl border bg-muted/30 p-4">
                <p className="break-words font-medium">
                  {user.name || "Your account"}
                </p>
                <p className="mt-1 break-all text-sm text-muted-foreground">
                  {user.email}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Signed in with GitHub
                </p>
              </div>
              <section>
                <h2 className="text-sm font-medium">
                  Your data belongs to you
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Download conversations, memories, projects, artifact
                  revisions, file metadata and extracted text as JSON. Download
                  original files separately before deleting them.
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  disabled={pending !== null}
                  aria-busy={pending === "export"}
                  onClick={() => void downloadExport()}
                >
                  {pending === "export" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  Export data
                </Button>
              </section>
              <section className="border-t pt-5">
                <h2 className="text-sm font-medium">Delete account</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Permanently remove your account, sessions, conversations,
                  memories, projects, artifacts, and saved provider keys, and
                  queue private file cleanup. Uncertain remote writes may need
                  operator reconciliation.
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  disabled={pending !== null}
                  ref={deleteOpener}
                  onClick={() => {
                    setFailure(null);
                    setConfirmDelete(true);
                  }}
                >
                  <Trash2 className="text-destructive" />
                  Delete account
                </Button>
              </section>
            </TabsContent>
            <TabsContent value="appearance" className="space-y-6">
              <ThemeControl />
              <CreditNotice />
            </TabsContent>
            <TabsContent value="providers">
              <ProviderSettings client={providerClient} />
              <SearchProviderSettings />
            </TabsContent>
            <TabsContent
              value="security"
              className="space-y-4 text-sm leading-relaxed text-muted-foreground"
            >
              <h2 className="font-medium text-foreground">
                Private to your account
              </h2>
              <p>
                Conversations, memories, projects, and artifacts are accessible
                through your signed-in account. Expired and revoked sessions
                cannot open them.
              </p>
              <p>
                Sign-in uses GitHub and a server-managed invite list. This app
                does not create a local password.
              </p>
              <p>
                When model access is enabled, your messages will be processed by
                the selected provider. Avoid sharing secrets or sensitive
                personal data.
              </p>
            </TabsContent>
          </Tabs>
          {failure && !confirmDelete && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (!pending) setConfirmDelete(next);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (deleteOpener.current?.isConnected) deleteOpener.current.focus();
            else onCloseFocus?.();
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your account, saved conversations,
              memories, projects, artifacts and their revisions, and provider
              keys, then signs you out. Export anything you want to keep first.
              This cannot be undone. Private files are queued for deletion;
              unfinished remote writes may retain anonymous cleanup records
              until reconciled.
            </DialogDescription>
          </DialogHeader>
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending !== null}
              onClick={() => setConfirmDelete(false)}
              autoFocus
            >
              Keep account
            </Button>
            <Button
              variant="destructive"
              aria-busy={pending === "delete"}
              disabled={pending !== null}
              onClick={() => void removeAccount()}
            >
              {pending === "delete" ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              Delete account permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
