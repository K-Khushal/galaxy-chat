import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Account } from "./account";
import { SETTINGS_COPY } from "./copy";
import {
  SettingsFrame,
  SettingsGroup,
  SettingsList,
  SettingsRow,
} from "./settings-group";
import { General } from "./theme-control";

/** Row text is skeletoned only where it comes from data; titles are real. */
const textBar = <SkeletonText lines={1} widths={["60%"]} className="w-40" />;

function FieldSkeleton({ label }: { label: string }) {
  return (
    <div className="grid gap-1.5">
      <div className="text-sm font-medium select-none">{label}</div>
      <Skeleton className="h-24 rounded-lg" />
    </div>
  );
}

function ArchivedRowSkeleton() {
  return (
    <div className="flex min-h-14 items-center gap-2 px-4 py-3">
      <SkeletonText
        lines={1}
        widths={["55%"]}
        className="min-w-0 flex-1 text-sm"
      />
      <Skeleton className="size-8 rounded-lg pointer-coarse:min-h-11 pointer-coarse:min-w-11" />
      <Skeleton className="size-8 rounded-lg pointer-coarse:min-h-11 pointer-coarse:min-w-11" />
    </div>
  );
}

function UsageRowSkeleton() {
  return (
    <div className="px-4 py-2 text-sm">
      <SkeletonText lines={1} widths={["70%"]} />
    </div>
  );
}

/**
 * The real group titles, row titles and form labels around skeleton data, in
 * the same frame, rows and fixed-height lists as the content, so nothing moves
 * when the data lands. General and Account need no data and render for real.
 */
export function SettingsSkeleton() {
  return (
    <>
      <General />
      <SettingsGroup title="Personalization" className="p-4">
        <div className="grid gap-4">
          <FieldSkeleton label={SETTINGS_COPY.aboutYou} />
          <FieldSkeleton label={SETTINGS_COPY.respond} />
          <div className="flex justify-end">
            <Button disabled>{SETTINGS_COPY.save}</Button>
          </div>
        </div>
      </SettingsGroup>
      <SettingsGroup title={SETTINGS_COPY.openRouterKey}>
        <SettingsRow
          stack
          title={SETTINGS_COPY.openRouterKey}
          description={textBar}
        >
          <Skeleton className="h-8 w-24 rounded-lg pointer-coarse:min-h-11" />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Usage">
        <SettingsRow title={SETTINGS_COPY.credits}>
          <Skeleton className="h-5 w-20" />
        </SettingsRow>
        <SettingsList className="divide-y">
          {Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows never reorder
            <UsageRowSkeleton key={i} />
          ))}
        </SettingsList>
      </SettingsGroup>
      <SettingsGroup title="Archived chats">
        <SettingsList className="divide-y">
          {Array.from({ length: 4 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows never reorder
            <ArchivedRowSkeleton key={i} />
          ))}
        </SettingsList>
      </SettingsGroup>
      <Account />
    </>
  );
}

export function SettingsLoading() {
  return (
    <SettingsFrame>
      <SettingsSkeleton />
    </SettingsFrame>
  );
}
