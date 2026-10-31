import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Centred message used for empty, error and not-found states. */
export function StatePanel({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-6 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-medium tracking-tight">{title}</h1>
        {description ? (
          <p className="max-w-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
