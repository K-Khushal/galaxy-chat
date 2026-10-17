import { ChatHeader } from "@/components/shell/chat-header";
import { Skeleton } from "@/components/ui/skeleton";
export function ChatLoading() {
  return (
    <div className="flex h-dvh min-w-0 flex-col">
      <ChatHeader title="Loading conversation" />
      <div
        aria-live="polite"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10"
      >
        <span className="sr-only">Loading conversation</span>
        <Skeleton className="ml-auto h-16 w-3/4 rounded-2xl" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      <div className="mx-auto w-full max-w-3xl px-6 pb-8">
        <Skeleton className="h-36 rounded-2xl" />
      </div>
    </div>
  );
}
