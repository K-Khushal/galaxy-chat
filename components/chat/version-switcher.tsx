import { ChevronLeft, ChevronRight } from "lucide-react";
import type { VersionInfo } from "@/lib/chat/tree";
import { ActionButton } from "./reply-actions";

export function VersionSwitcher({
  versions,
  disabled,
  onSwitch,
}: {
  versions: VersionInfo;
  disabled: boolean;
  onSwitch: (id: string) => void;
}) {
  if (versions.ids.length < 2) return null;
  return (
    <fieldset
      className="inline-flex items-center text-caption text-muted-foreground tabular-nums"
      aria-label="Message Versions"
    >
      <ActionButton
        label="Previous Version"
        disabled={disabled || versions.index <= 0}
        onClick={() => onSwitch(versions.ids[versions.index - 1])}
      >
        <ChevronLeft />
      </ActionButton>
      <span aria-live="polite">
        {versions.index + 1}/{versions.ids.length}
      </span>
      <ActionButton
        label="Next Version"
        disabled={disabled || versions.index >= versions.ids.length - 1}
        onClick={() => onSwitch(versions.ids[versions.index + 1])}
      >
        <ChevronRight />
      </ActionButton>
    </fieldset>
  );
}
