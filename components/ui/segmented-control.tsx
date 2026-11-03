"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A small set of mutually exclusive choices; each option is a `radio` named by its label. */
function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  "aria-label": ariaLabel,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  "aria-label": string;
  className?: string;
}) {
  return (
    <RadioGroup
      data-slot="segmented-control"
      aria-label={ariaLabel}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      className={cn("inline-flex rounded-lg bg-muted p-0.5", className)}
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          data-slot="segmented-control-item"
          className="inline-flex h-8 cursor-default items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,box-shadow] duration-80 ease-out outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-card data-checked:text-foreground data-checked:shadow-xs data-disabled:opacity-50 pointer-coarse:min-h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
        >
          {option.icon}
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

export { SegmentedControl };
