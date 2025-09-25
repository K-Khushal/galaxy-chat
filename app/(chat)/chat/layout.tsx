import { AppSidebar } from "@/components/chat/app-sidebar";
import {
    SidebarInset,
    SidebarProvider,
    SidebarTrigger
} from "@/components/ui/sidebar";
import { getOrCreateUserProfile } from "@/lib/actions/auth/user";
import { toSidebarUser, toUserProfileInput } from "@/lib/mappers/user";
import { currentUser } from "@clerk/nextjs/server";
import { ChatUserProvider } from "./user-provider";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {

    const clerkUser = await currentUser();
    const profileInput = toUserProfileInput(clerkUser);
    if (profileInput) {
        await getOrCreateUserProfile(profileInput);
    }

    const sidebarUser = toSidebarUser(clerkUser);


    return (
        <SidebarProvider>
            <AppSidebar user={sidebarUser} />
            <SidebarInset>
                <header className="flex h-16 shrink-0 items-center gap-2 px-4">
                    <SidebarTrigger className="-ml-1" />
                </header>
                <ChatUserProvider user={sidebarUser}>
                    {children}
                </ChatUserProvider>
            </SidebarInset>
        </SidebarProvider>
    )
}
