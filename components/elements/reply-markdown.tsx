"use client";

// Only Replies render math, so the KaTeX styles ship with them rather than with every page.
import "katex/dist/katex.min.css";
import { type ComponentProps, lazy, memo, Suspense } from "react";
import type { Streamdown as StreamdownComponent } from "streamdown";
import { cn } from "@/lib/utils";

// Streamdown carries the markdown parser, KaTeX and the code grammars (about
// 500 KB gzipped). Loading it lazily lets the page hydrate first; the server
// still renders the full Reply, so nothing shifts when it arrives.
type ReplyMarkdownProps = ComponentProps<typeof StreamdownComponent>;

// Streamdown sanitizes after KaTeX by default, which strips KaTeX's classes and
// MathML. Sanitize the Markdown HTML first, then typeset trusted KaTeX output.
const loadStreamdown = () =>
  import("streamdown").then(({ Streamdown, defaultRehypePlugins }) => {
    const { raw, sanitize, katex, harden } = defaultRehypePlugins;
    const rehypePlugins = [raw, sanitize, katex, harden];
    return {
      default: (props: ReplyMarkdownProps) => (
        <Streamdown rehypePlugins={rehypePlugins} {...props} />
      ),
    };
  });
const Streamdown = lazy(loadStreamdown);

const style =
  "w-full min-w-0 break-words leading-7 [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_a]:underline [&_a]:underline-offset-4";

/**
 * `isAnimating` marks the Reply that is still being written. Only that one
 * needs Streamdown's deferred "streaming" mode; a finished one renders in a
 * single pass, so it is part of the server HTML and shows before hydration.
 */
export const ReplyMarkdown = memo(
  ({ className, isAnimating, mode, ...props }: ReplyMarkdownProps) => (
    <Suspense
      fallback={
        <div className={cn(style, "whitespace-pre-wrap", className)}>
          {props.children}
        </div>
      }
    >
      <Streamdown
        className={cn(style, className)}
        isAnimating={isAnimating}
        mode={mode ?? (isAnimating ? "streaming" : "static")}
        {...props}
      />
    </Suspense>
  ),
);

ReplyMarkdown.displayName = "ReplyMarkdown";
