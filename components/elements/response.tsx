"use client";

import { type ComponentProps, memo } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

type ResponseProps = ComponentProps<typeof Streamdown>;

export const Response = memo(({ className, ...props }: ResponseProps) => (
  <Streamdown
    className={cn(
      "w-full min-w-0 break-words leading-7 [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_a]:underline [&_a]:underline-offset-4",
      className,
    )}
    {...props}
  />
));

Response.displayName = "Response";
