import { SearchX } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <EmptyState
        size="page"
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
