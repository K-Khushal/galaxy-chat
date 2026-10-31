"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
          OpenRouter bills your account for Replies made with your key. Your key
          is encrypted when saved.
        </DialogDescription>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/api/byok", { key }, "PUT");
              setKey("");
              onSaved();
              onOpenChange(false);
            } catch (error) {
              setError(errorCopy(error as Error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="byok-key">OpenRouter key</label>
          <Input
            id="byok-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={busy || !key.trim()}>
            {busy ? "Checking key…" : "Save key"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
