import { cn } from "@/lib/utils";

/*
 * Waits 160ms, fades in over 240ms, then pulses every 2s (no pulse under
 * reduced motion). Only leaf data becomes a Skeleton; known chrome renders
 * for real.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "rounded-md bg-accent opacity-0 animate-[skeleton-in_240ms_ease-out_160ms_forwards] motion-safe:animate-[skeleton-in_240ms_ease-out_160ms_forwards,skeleton-pulse_2s_ease-in-out_400ms_infinite]",
        className,
      )}
      {...props}
    />
  );
}

// Deterministic, so server and client markup match.
const LINE_WIDTHS = ["100%", "92%", "76%"];
const LAST_LINE_WIDTH = "60%";
const TITLE_WIDTH = "64%";

/**
 * Lines that take exactly the height of the text they stand in for: put it
 * inside the same text-role class (`text-message`, `text-sm`…). Each row is
 * one line-height tall with a bar of 0.7em centred in it.
 */
function SkeletonText({
  lines = 3,
  widths,
  className,
}: {
  lines?: number;
  widths?: string[];
  className?: string;
}) {
  const widthAt = (i: number) => {
    if (widths?.length) return widths[i % widths.length];
    if (lines === 1) return TITLE_WIDTH;
    if (i === lines - 1) return LAST_LINE_WIDTH;
    return LINE_WIDTHS[i % LINE_WIDTHS.length];
  };
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton-text"
      className={cn("flex flex-col", className)}
    >
      {Array.from({ length: lines }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and never reorder
        <div key={i} className="flex h-[1lh] items-center">
          <Skeleton className="h-[0.7em]" style={{ width: widthAt(i) }} />
        </div>
      ))}
    </div>
  );
}

export { Skeleton, SkeletonText };
