import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The Settings page frame: scroll container, column and `h1`. */
export function SettingsFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-2xl gap-8 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-heading font-semibold">Settings</h1>
        {children}
      </div>
    </div>
  );
}

export function SettingsGroup({
  title,
  className,
  children,
}: {
  title: string;
  /** Overrides the card layout, for groups that are not a list of rows. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-title font-medium">{title}</h2>
      <div
        className={cn(
          "divide-y overflow-hidden rounded-xl border bg-card shadow-xs",
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Variable-length lists scroll in a region of fixed height, so a short, long or
 * empty list takes the same space and the groups below never move.
 */
export function SettingsList({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    // A `section` with an `aria-label` is a landmark region.
    <section
      className={cn("h-56 overflow-y-auto overscroll-contain", className)}
      {...props}
    />
  );
}

export function SettingsRow({
  title,
  description,
  children,
  stack = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /**
   * Below `sm`, always put the controls under the text. For rows whose
   * controls change width with data, so the row has one height either way.
   */
  stack?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3",
        stack && "max-sm:flex-col max-sm:items-start",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {description ? (
          <div className="text-caption text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {children ? (
        <div
          className={cn("ml-auto flex flex-wrap gap-2", stack && "max-sm:ml-0")}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
