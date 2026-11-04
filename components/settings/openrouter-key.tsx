"use client";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorCopy } from "@/components/chat/api";
import { ByokDialog } from "@/components/chat/byok-dialog";
import { Button } from "@/components/ui/button";
import { LocalDate } from "./local-date";
import { SettingsGroup, SettingsRow } from "./settings-group";

const ADDED = { day: "numeric", month: "short", year: "numeric" } as const;

export function OpenRouterKey({
  saved,
  onChanged,
}: {
  saved: { updatedAt: string } | null;
  /** Reloads Settings after the key is saved, replaced or removed. */
  onChanged: () => Promise<void>;
}) {
  const [dialog, setDialog] = useState(false);
  const [pending, setPending] = useState<"test" | "remove" | null>(null);

  async function run(
    action: "test" | "remove",
    work: () => Promise<void>,
    success: string,
  ) {
    setPending(action);
    try {
      await work();
      toast.success(success);
    } catch (error) {
      toast.error(errorCopy(error as Error));
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <SettingsGroup title="OpenRouter key">
        <SettingsRow
          title="OpenRouter key"
          description={
            saved ? (
              <>
                Added <LocalDate value={saved.updatedAt} format={ADDED} />
              </>
            ) : (
              "No OpenRouter key saved."
            )
          }
        >
          {saved ? (
            <>
              <Button
                variant="outline"
                size="sm"
                pending={pending === "test"}
                disabled={pending !== null}
                onClick={() =>
                  void run(
                    "test",
                    async () => {
                      const result = await api<{ ok: boolean }>(
                        "/api/byok/test",
                        {},
                      );
                      if (!result.ok) throw new Error("provider_key_rejected");
                    },
                    "Your key works.",
                  )
                }
              >
                Test key
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending !== null}
                onClick={() => setDialog(true)}
              >
                Replace key
              </Button>
              <Button
                variant="destructive-subtle"
                size="sm"
                pending={pending === "remove"}
                disabled={pending !== null}
                onClick={() =>
                  void run(
                    "remove",
                    async () => {
                      await api("/api/byok", {}, "DELETE");
                      await onChanged();
                    },
                    "Key removed.",
                  )
                }
              >
                Remove key
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setDialog(true)}>
              Add key
            </Button>
          )}
        </SettingsRow>
      </SettingsGroup>
      <ByokDialog
        open={dialog}
        onOpenChange={setDialog}
        onSaved={() => void onChanged()}
      />
    </>
  );
}
