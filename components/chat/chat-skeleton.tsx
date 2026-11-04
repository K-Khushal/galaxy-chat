import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { ComposerSkeleton } from "./composer-skeleton";

/*
 * The frame classes of a live Chat, shared with its skeleton so the composer
 * stays where it is when the Messages arrive. Not a client module:
 * loading.tsx renders it on the server.
 */
export const MESSAGE_FRAME = "mx-auto w-full max-w-3xl px-4 pb-6";
export const COMPOSER_AREA =
  "mx-auto w-full max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]";

/** One exchange: a User Message, a Reply, and the composer below it. */
export function ChatSkeleton() {
  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <output className="sr-only">Loading Chat</output>
        <div aria-hidden="true" className={MESSAGE_FRAME}>
          <div className="flex flex-col items-end py-3">
            <Skeleton className="h-11 w-2/5 rounded-[1.25rem]" />
            <div className="mt-1 h-8" />
          </div>
          <div className="py-3">
            <SkeletonText lines={4} className="text-message" />
            <div className="mt-1 h-8" />
          </div>
        </div>
      </div>
      <div className={COMPOSER_AREA}>
        <ComposerSkeleton />
      </div>
    </>
  );
}
