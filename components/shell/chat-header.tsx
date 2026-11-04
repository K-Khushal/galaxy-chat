import { TemporaryToggle } from "@/components/shell/temporary-toggle";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function ChatHeader() {
  return (
    <header className="flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 items-center gap-1 px-2 md:px-3 pt-[env(safe-area-inset-top)]">
      <SidebarTrigger className="md:hidden" />
      <div className="flex-1" />
      <TemporaryToggle />
    </header>
  );
}
