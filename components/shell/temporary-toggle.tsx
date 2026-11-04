"use client";

import { MessageCircleDashed } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function TemporaryToggle() {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === "/chat/settings") return null;
  const on = pathname === "/chat/temporary";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Temporary chat"
            aria-pressed={on}
            className="text-muted-foreground aria-pressed:bg-primary/10 aria-pressed:text-primary hover:aria-pressed:bg-primary/15"
            onClick={() => router.push(on ? "/chat" : "/chat/temporary")}
          />
        }
      >
        <MessageCircleDashed />
      </TooltipTrigger>
      <TooltipContent>
        {on ? "Turn off Temporary chat" : "Temporary chat"}
      </TooltipContent>
    </Tooltip>
  );
}
