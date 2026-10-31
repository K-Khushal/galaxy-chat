"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await authClient.signOut();
      router.replace("/sign-in");
    } catch {
      setPending(false);
      toast.error("Sign out failed");
    }
  }

  return (
    <Button
      variant="outline"
      disabled={pending}
      aria-busy={pending}
      onClick={() => void signOut()}
    >
      {pending ? "Signing out..." : "Sign out"}
    </Button>
  );
}
