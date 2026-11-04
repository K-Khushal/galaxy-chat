"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, errorCopy } from "./api";
export function ByokDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setKey("");
        setError("");
        onOpenChange(value);
      }}
    >
      <DialogContent>
        <DialogTitle>Add your OpenRouter key</DialogTitle>
        <DialogDescription>
          Replies made with your key are billed by OpenRouter.{" "}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            Get a key
          </a>
        </DialogDescription>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/api/byok", { key }, "PUT");
              setKey("");
              // The usage meter and the model picker follow the key.
              window.dispatchEvent(new Event("galaxy-account-changed"));
              onSaved();
              onOpenChange(false);
            } catch (error) {
              setError(errorCopy(error as Error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field invalid={!!error}>
            <FieldLabel>OpenRouter key</FieldLabel>
            <Input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setError("");
              }}
              required
            />
            <FieldError>{error}</FieldError>
          </Field>
          <Button type="submit" pending={busy} disabled={!key.trim()}>
            Save key
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
