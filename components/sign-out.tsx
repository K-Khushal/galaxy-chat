"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/client";

export default function SignOut() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  return (
    <DropdownMenuItem
      className="cursor-pointer"
      disabled={isSigningOut}
      onSelect={(event) => {
        event.preventDefault();
        if (isSigningOut) {
          return;
        }
        setIsSigningOut(true);
        void authClient
          .signOut()
          .then(() => {
            router.replace("/");
          })
          .catch(() => {
            setIsSigningOut(false);
            toast.error("Sign out failed");
          });
      }}
    >
      <LogOut />
      {isSigningOut ? "Signing out..." : "Log out"}
    </DropdownMenuItem>
  );
}
