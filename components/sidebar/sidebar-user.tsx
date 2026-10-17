"use client";
import { ChevronsUpDown, LogOut, Settings2 } from "lucide-react";
import { useRef, useState } from "react";
import {
  type AccountActions,
  SettingsDialog,
} from "@/components/account-settings";
import SignOut from "@/components/sign-out";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { TypeUserProfile } from "@/lib/types";
export function SidebarUser({
  user,
  actions,
}: {
  user: TypeUserProfile;
  actions?: AccountActions;
}) {
  const { isMobile } = useSidebar();
  const [settings, setSettings] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                ref={opener}
                size="lg"
                tooltip="Account & settings"
                className="min-h-12"
                aria-label="Account & settings"
              >
                <Avatar className="size-8 shrink-0 rounded-xl">
                  <AvatarImage src={user.imageUrl} alt="" />
                  <AvatarFallback className="rounded-xl bg-primary/10 text-primary">
                    {user.name?.trim().charAt(0).toUpperCase() || "G"}
                  </AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 gap-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-sm font-medium">
                    {user.name || "Your account"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    Personal workspace
                  </span>
                </div>
                <ChevronsUpDown className="size-3.5 text-muted-foreground group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side={isMobile ? "top" : "right"}
              align="end"
              className="min-w-56"
            >
              <DropdownMenuItem onSelect={() => setSettings(true)}>
                <Settings2 />
                Account & settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {actions ? (
                <DropdownMenuItem onSelect={() => actions.signOut?.()}>
                  <LogOut />
                  Sign out (preview)
                </DropdownMenuItem>
              ) : (
                <SignOut />
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <SettingsDialog
        open={settings}
        setOpen={setSettings}
        user={user}
        actions={actions}
        onCloseFocus={() => opener.current?.focus()}
      />
    </>
  );
}
