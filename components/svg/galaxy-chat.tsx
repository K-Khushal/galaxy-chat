import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export default function GalaxyChat({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md",
        className,
      )}
    >
      <Sparkles className="size-4" />
    </div>
  );
}
