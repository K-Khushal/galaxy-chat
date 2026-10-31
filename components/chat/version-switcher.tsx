import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VersionInfo } from "@/lib/chat/tree";
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
      className="flex items-center text-xs text-muted-foreground"
      aria-label="Message Versions"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous Version"
        disabled={disabled || versions.index <= 0}
        onClick={() => onSwitch(versions.ids[versions.index - 1])}
      >
        <ChevronLeft />
      </Button>
      <span aria-live="polite">
        {versions.index + 1}/{versions.ids.length}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next Version"
        disabled={disabled || versions.index >= versions.ids.length - 1}
        onClick={() => onSwitch(versions.ids[versions.index + 1])}
      >
        <ChevronRight />
      </Button>
    </fieldset>
  );
}
