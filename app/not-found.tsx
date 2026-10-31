import { SearchX } from "lucide-react";
import Link from "next/link";
import { StatePanel } from "@/components/shell/state-panel";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <StatePanel
        icon={<SearchX />}
        title="Page not found"
        description="This page doesn't exist or has moved."
        action={
          <Link href="/chat" className={buttonVariants({ variant: "outline" })}>
            Back to Galaxy
          </Link>
        }
      />
    </main>
  );
}
