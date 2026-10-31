"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";

export function useSignOut() {
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

  return { pending, signOut };
}
