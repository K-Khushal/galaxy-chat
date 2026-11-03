"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Label, control and error in one column. Base UI wires `id`, `htmlFor`,
 * `aria-describedby` and `aria-invalid`, so `Input` and `Textarea` inside a
 * Field need no manual ids.
 */
function Field({ className, ...props }: FieldPrimitive.Root.Props) {
  return (
    <FieldPrimitive.Root
      data-slot="field"
      className={cn("grid gap-1.5", className)}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn(
        "text-sm font-medium select-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** Only for facts the person can't infer from the label. */
function FieldDescription({
  className,
  ...props
}: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cn("text-caption text-muted-foreground", className)}
      {...props}
    />
  );
}

/** Renders only with children, directly below the control. */
function FieldError({
  children,
  className,
  ...props
}: Omit<FieldPrimitive.Error.Props, "children" | "match"> & {
  children?: ReactNode;
}) {
  if (children == null || children === false || children === "") return null;
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      match
      aria-live="polite"
      className={cn("flex gap-1.5 text-caption text-destructive", className)}
      {...props}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </FieldPrimitive.Error>
  );
}

/** Appears near the limit and turns destructive at it. */
function FieldCounter({
  value,
  max,
  showFrom = 0.9 * max,
  className,
}: {
  value: number;
  max: number;
  showFrom?: number;
  className?: string;
}) {
  if (value < showFrom) return null;
  return (
    <p
      data-slot="field-counter"
      className={cn(
        "justify-self-end text-xs text-muted-foreground tabular-nums",
        value >= max && "text-destructive",
        className,
      )}
    >
      {value.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
    </p>
  );
}

export { Field, FieldCounter, FieldDescription, FieldError, FieldLabel };
