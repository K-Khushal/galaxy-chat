import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";
import type { TypeUserProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let profile: TypeUserProfile;
  try {
    const access = await requireChatAccess(await headers());
    profile = {
      userId: access.userId,
      name: access.name,
      email: access.email,
      imageUrl: access.image,
    };
  } catch (error) {
    if (error instanceof AppError) {
      redirect(`/sign-in?notice=${error.id}`);
    }
    throw error;
  }

  return (
    <SidebarProvider>
      <AppSidebar user={profile} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
