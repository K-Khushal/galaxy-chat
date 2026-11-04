import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { SettingsFrame, SettingsGroup, SettingsRow } from "./settings-group";

/** A row with its leaf data skeletoned: a title bar and one control. */
function RowSkeleton({
  description = false,
  control = "h-8 w-24",
}: {
  description?: boolean;
  control?: string;
}) {
  return (
    <SettingsRow
      title={<SkeletonText lines={1} widths={["75%"]} className="w-40" />}
      description={
        description ? (
          <SkeletonText lines={1} widths={["60%"]} className="w-72" />
        ) : undefined
      }
    >
      <Skeleton className={control} />
    </SettingsRow>
  );
}

function FieldSkeleton() {
  return (
    <div className="grid gap-1.5">
      <SkeletonText lines={1} widths={["30%"]} className="text-sm" />
      <Skeleton className="h-24 rounded-lg" />
    </div>
  );
}

/** The real group titles with skeleton rows, so nothing moves when data lands. */
export function SettingsSkeleton() {
  return (
    <>
      <SettingsGroup title="General">
        <RowSkeleton control="h-9 w-[16.3rem] rounded-lg" />
      </SettingsGroup>
      <SettingsGroup
        title="Personalization"
        className="grid gap-4 divide-y-0 p-4"
      >
        <FieldSkeleton />
        <FieldSkeleton />
        <div className="flex justify-end">
          <Skeleton className="h-9 w-36 rounded-lg" />
        </div>
      </SettingsGroup>
      <SettingsGroup title="OpenRouter key">
        <RowSkeleton description />
      </SettingsGroup>
      <SettingsGroup title="Usage">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </SettingsGroup>
      <SettingsGroup title="Archived chats">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </SettingsGroup>
      <SettingsGroup title="Account">
        <RowSkeleton />
        <RowSkeleton description />
      </SettingsGroup>
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
