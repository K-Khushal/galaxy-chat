import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Only inside buttons; everything else loads with skeletons. */
export function Spinner({ className }: { className?: string }) {
  return (
    <LoaderCircle
      aria-hidden="true"
      data-slot="spinner"
      className={cn("size-4 animate-spin", className)}
    />
  );
}
