"use client";
import { useState } from "react";
import { api, errorCopy } from "@/components/chat/api";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { SettingsGroup, SettingsRow } from "./settings-group";

export function Account() {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function deleteAccount() {
    setDeleting(true);
    setError("");
    try {
      await api("/api/account", { confirmation }, "DELETE");
    } catch (failure) {
      setError(errorCopy(failure as Error));
      setDeleting(false);
      return;
    }
    // The account is gone: stay pending until the browser has left the page.
    try {
      await authClient.signOut();
    } finally {
      window.location.assign("/sign-in");
    }
  }

  return (
    <>
      <SettingsGroup title="Account">
        <SettingsRow title="Export data">
          <Button
            variant="outline"
            size="sm"
            render={
              <a href="/api/account/export" download>
                Export account as JSON
              </a>
            }
          />
        </SettingsRow>
        <SettingsRow
          title="Delete account"
          description="Permanently deletes your Chats, Messages, keys and settings."
        >
          <Button
            variant="destructive-subtle"
            size="sm"
            onClick={() => setOpen(true)}
          >
            Delete account
          </Button>
        </SettingsRow>
      </SettingsGroup>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (deleting) return;
          setOpen(next);
          if (!next) {
            setConfirmation("");
            setError("");
          }
        }}
      >
        <AlertDialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (confirmation === "DELETE") void deleteAccount();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This can't be undone. We keep a hashed record of your sign-in so
                sign-up Credits aren't granted again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Field invalid={!!error} disabled={deleting}>
              <FieldLabel>Type DELETE to confirm</FieldLabel>
              <Input
                autoComplete="off"
                value={confirmation}
                onChange={(e) => {
                  setConfirmation(e.target.value);
                  setError("");
                }}
              />
              <FieldError>{error}</FieldError>
            </Field>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <Button
                type="submit"
                variant="destructive"
                pending={deleting}
                disabled={confirmation !== "DELETE"}
              >
                Delete account permanently
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
