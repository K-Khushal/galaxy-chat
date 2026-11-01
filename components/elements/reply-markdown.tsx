"use client";

import { type ComponentProps, memo } from "react";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

type ReplyMarkdownProps = ComponentProps<typeof Streamdown>;

// Streamdown sanitizes after KaTeX by default, which strips KaTeX's classes and
// MathML. Sanitize the Markdown HTML first, then typeset trusted KaTeX output.
const { raw, sanitize, katex, harden } = defaultRehypePlugins;
const rehypePlugins = [raw, sanitize, katex, harden];

export const ReplyMarkdown = memo(
  ({ className, ...props }: ReplyMarkdownProps) => (
    <Streamdown
      className={cn(
        "w-full min-w-0 break-words leading-7 [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_a]:underline [&_a]:underline-offset-4",
        className,
      )}
      rehypePlugins={rehypePlugins}
      {...props}
    />
  ),
);

ReplyMarkdown.displayName = "ReplyMarkdown";
