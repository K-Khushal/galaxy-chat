import { ArrowUp, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/*
 * The composer's frame, shared with the real Composer so the skeleton and the
 * loaded page have identical bounds. Not a client module: loading.tsx renders
 * it on the server.
 */
export const COMPOSER_FRAME =
  "flex w-full flex-col gap-1.5 rounded-3xl border border-input bg-card p-2 shadow-sm transition-[border-color,box-shadow] duration-160 ease-out focus-within:border-ring/60 focus-within:shadow-md data-dragging:border-dashed data-dragging:border-ring data-dragging:bg-primary/5";
export const COMPOSER_TEXTAREA =
  "field-sizing-content min-h-11 max-h-[40dvh] w-full resize-none bg-transparent px-2.5 py-2 text-message outline-none placeholder:text-muted-foreground";
export const COMPOSER_TOOLBAR = "flex items-center gap-1";
export const SEND_BUTTON =
  "rounded-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100";
// A toolbar slot that holds the height of a real control while it loads.
const SLOT = "flex h-8 items-center px-2.5 pointer-coarse:min-h-11";

/** The empty composer with its leaves loading: same chrome, nothing to do yet. */
export function ComposerSkeleton() {
  return (
    <div aria-hidden="true" className={COMPOSER_FRAME}>
      <textarea
        disabled
        rows={1}
        tabIndex={-1}
        placeholder="Message Galaxy"
        className={COMPOSER_TEXTAREA}
      />
      <div className={COMPOSER_TOOLBAR}>
        <Button
          type="button"
          disabled
          tabIndex={-1}
          variant="ghost"
          size="icon-sm"
          className="rounded-full text-muted-foreground"
        >
          <Paperclip />
        </Button>
        <div className={SLOT}>
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex-1" />
        <div className={SLOT}>
          <Skeleton className="h-4 w-20" />
        </div>
        <Button
          type="button"
          disabled
          tabIndex={-1}
          size="icon-sm"
          className={SEND_BUTTON}
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  );
}
