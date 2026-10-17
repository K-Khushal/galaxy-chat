import type * as React from "react";
import type { AccountActions } from "@/components/account-settings";
import { CreditNotice } from "@/components/shell/credit-notice";
import { SidebarActions } from "@/components/sidebar/sidebar-actions";
import {
  type HistoryPreview,
  SidebarHistory,
} from "@/components/sidebar/sidebar-history";
import { SidebarUser } from "@/components/sidebar/sidebar-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import type { TypeUserProfile } from "@/lib/types";
import type { CreditStatus } from "@/lib/ui/credits";

export function AppSidebar({
  user,
  preview,
  creditStatus,
  onNewChat,
  accountActions,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: TypeUserProfile;
  preview?: HistoryPreview;
  creditStatus?: CreditStatus;
  onNewChat?: () => void;
  accountActions?: AccountActions;
}) {
  return (
    <Sidebar {...props} collapsible="icon">
      <SidebarHeader>
        <SidebarActions onNewChat={onNewChat} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarHistory preview={preview} />
      </SidebarContent>
      <SidebarFooter className="gap-3 border-t border-sidebar-border pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="group-data-[collapsible=icon]:hidden">
          <CreditNotice status={creditStatus} />
        </div>
        <SidebarUser user={user} actions={accountActions} />
      </SidebarFooter>
    </Sidebar>
  );
}
