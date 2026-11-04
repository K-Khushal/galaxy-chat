"use client";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorCopy } from "@/components/chat/api";
import { Button } from "@/components/ui/button";
import { Field, FieldCounter, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { SETTINGS_COPY } from "./copy";
import { SettingsGroup } from "./settings-group";

export type Instructions = { aboutYou: string; responseInstructions: string };
const MAX = 2000;

export function Personalization({
  saved,
  onSaved,
}: {
  saved: Instructions;
  onSaved: (settings: Instructions) => void;
}) {
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const dirty =
    draft.aboutYou !== saved.aboutYou ||
    draft.responseInstructions !== saved.responseInstructions;
  return (
    <SettingsGroup title="Personalization" className="p-4">
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await api("/api/settings", draft, "PUT");
            onSaved(draft);
            toast.success("Custom instructions saved.");
          } catch (error) {
            toast.error(errorCopy(error as Error));
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field disabled={saving}>
          <FieldLabel>{SETTINGS_COPY.aboutYou}</FieldLabel>
          <Textarea
            className="min-h-24"
            maxLength={MAX}
            value={draft.aboutYou}
            onChange={(e) => setDraft({ ...draft, aboutYou: e.target.value })}
          />
          <FieldCounter value={draft.aboutYou.length} max={MAX} />
        </Field>
        <Field disabled={saving}>
          <FieldLabel>{SETTINGS_COPY.respond}</FieldLabel>
          <Textarea
            className="min-h-24"
            maxLength={MAX}
            value={draft.responseInstructions}
            onChange={(e) =>
              setDraft({ ...draft, responseInstructions: e.target.value })
            }
          />
          <FieldCounter value={draft.responseInstructions.length} max={MAX} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={!dirty} pending={saving}>
            {SETTINGS_COPY.save}
          </Button>
        </div>
      </form>
    </SettingsGroup>
  );
}
