"use client";

import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useSignOut } from "@/components/auth/use-sign-out";
import { useAppleKeyboard } from "@/components/shell/use-apple-keyboard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { SidebarMenuButton } from "@/components/ui/sidebar";

export type AccountUser = { name: string; email: string; image?: string };

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "G"
  );
}

export function AccountMenu({ user }: { user: AccountUser }) {
  const { pending, signOut } = useSignOut();
  const apple = useAppleKeyboard();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            tooltip={user.name}
            className="data-open:bg-sidebar-accent"
          />
        }
      >
        <Avatar size="sm">
          {user.image ? <AvatarImage src={user.image} alt="" /> : null}
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
        <span className="grid min-w-0 flex-1 text-left leading-tight">
          <span className="truncate text-sm font-medium">{user.name}</span>
        </span>
        <ChevronsUpDown className="ml-auto text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <div className="grid gap-1 px-2 py-2">
          <span className="truncate text-sm font-medium">{user.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {user.email}
          </span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<Link href="/chat/settings" />}
          aria-keyshortcuts="Meta+Comma Control+Comma"
        >
          <Settings />
          Settings
          <Kbd className="ml-auto" aria-hidden>
            {apple ? "⌘," : "Ctrl ,"}
          </Kbd>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onClick={() => void signOut()}
          closeOnClick={false}
        >
          <LogOut />
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
