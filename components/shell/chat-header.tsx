import type { ReactNode } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";

/**
 * Top bar of the chat area. `children` is the slot (title, model picker) that
 * the `@header` parallel route fills; the trigger is only needed on mobile
 * because the sidebar has its own collapse button on desktop.
 */
export function ChatHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 px-3 pt-[env(safe-area-inset-top)]">
      <SidebarTrigger className="md:hidden" />
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </header>
  );
}
