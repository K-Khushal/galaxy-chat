"use client";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorCopy } from "@/components/chat/api";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldCounter,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/state";
import { Textarea } from "@/components/ui/textarea";
import { SETTINGS_COPY } from "./copy";
import { SettingsGroup } from "./settings-group";

export type Instructions = { aboutYou: string; responseInstructions: string };
const MAX = 2000;
const TOO_LONG = `Keep this under ${MAX.toLocaleString("en-US")} characters.`;
type Invalid = Partial<Record<keyof Instructions, string>>;

export function Personalization({
  saved,
  onSaved,
}: {
  saved: Instructions;
  onSaved: (settings: Instructions) => void;
}) {
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState<Invalid>({});
  const [failure, setFailure] = useState("");
  // Validate on submit, then re-validate on change once a field is invalid.
  const validate = (value: Instructions): Invalid => ({
    aboutYou: value.aboutYou.length > MAX ? TOO_LONG : undefined,
    responseInstructions:
      value.responseInstructions.length > MAX ? TOO_LONG : undefined,
  });
  function edit(next: Instructions) {
    setDraft(next);
    setFailure("");
    if (invalid.aboutYou || invalid.responseInstructions)
      setInvalid(validate(next));
  }
  const dirty =
    draft.aboutYou !== saved.aboutYou ||
    draft.responseInstructions !== saved.responseInstructions;
  return (
    <SettingsGroup title="Personalization" className="p-4">
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const problems = validate(draft);
          setInvalid(problems);
          if (problems.aboutYou || problems.responseInstructions) return;
          setSaving(true);
          setFailure("");
          try {
            await api("/api/settings", draft, "PUT");
            onSaved(draft);
            toast.success("Custom instructions saved.");
          } catch (error) {
            setFailure(errorCopy(error as Error));
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field disabled={saving} invalid={!!invalid.aboutYou}>
          <FieldLabel>{SETTINGS_COPY.aboutYou}</FieldLabel>
          <Textarea
            className="min-h-24"
            maxLength={MAX}
            value={draft.aboutYou}
            onChange={(e) => edit({ ...draft, aboutYou: e.target.value })}
          />
          <FieldError>{invalid.aboutYou}</FieldError>
          <FieldCounter value={draft.aboutYou.length} max={MAX} />
        </Field>
        <Field disabled={saving} invalid={!!invalid.responseInstructions}>
          <FieldLabel>{SETTINGS_COPY.respond}</FieldLabel>
          <Textarea
            className="min-h-24"
            maxLength={MAX}
            value={draft.responseInstructions}
            onChange={(e) =>
              edit({ ...draft, responseInstructions: e.target.value })
            }
          />
          <FieldError>{invalid.responseInstructions}</FieldError>
          <FieldCounter value={draft.responseInstructions.length} max={MAX} />
        </Field>
        {failure ? <InlineAlert tone="error">{failure}</InlineAlert> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={!dirty} pending={saving}>
            {SETTINGS_COPY.save}
          </Button>
        </div>
      </form>
    </SettingsGroup>
  );
}
