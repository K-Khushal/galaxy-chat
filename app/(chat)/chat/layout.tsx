import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getOrCreateUserProfile } from "@/lib/actions/auth/user";
import { toSidebarUser, toUserProfileInput } from "@/lib/mappers/user";
import { currentUser } from "@clerk/nextjs/server";
import { ChatUserProvider } from "./user-provider";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const clerkUser = await currentUser();
  const profileInput = toUserProfileInput(clerkUser);
  if (profileInput) {
    // Fire-and-forget to avoid blocking first paint, but ensure errors are logged
    void getOrCreateUserProfile(profileInput).catch((error) => {
      console.error("getOrCreateUserProfile failed", {
        context: "ChatLayout",
        userId: profileInput.userId,
        error,
      });
    });
  }

  const sidebarUser = toSidebarUser(clerkUser);

  return (
    <SidebarProvider>
      <AppSidebar user={sidebarUser} />
      <SidebarInset>
        <ChatUserProvider user={sidebarUser ?? null}>
          {children}
        </ChatUserProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
