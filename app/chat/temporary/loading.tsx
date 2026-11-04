import { ComposerSkeleton } from "@/components/chat/composer-skeleton";

// The empty Temporary chat: the New Chat layout with its own prompt.
export default function Loading() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <output className="sr-only">Loading</output>
      <div className="w-full max-w-3xl pb-[8vh]">
        <h1 className="text-center text-display font-semibold">
          Temporary chat
        </h1>
        <p className="mt-1.5 mb-6 text-center text-sm text-muted-foreground">
          Not saved to history.
        </p>
        <ComposerSkeleton />
      </div>
    </div>
  );
}
