import { ComposerSkeleton } from "@/components/chat/composer-skeleton";
import { NewChatLayout } from "@/components/chat/new-chat";

// Only the New Chat page: /chat/[id] and /chat/settings have their own.
export default function Loading() {
  return (
    <NewChatLayout>
      <output className="sr-only">Loading</output>
      <ComposerSkeleton />
    </NewChatLayout>
  );
}
