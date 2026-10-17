import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Chat from "@/components/chat/chat";
import { readBranches } from "@/lib/actions/chat/branches";
import { getChatForUser } from "@/lib/actions/chat/chat";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { id } = await params;
  let userId = "";
  try {
    userId = (await requireChatAccess(await headers())).userId;
  } catch (error) {
    if (error instanceof AppError) {
      redirect(`/sign-in?notice=${error.id}`);
    }
    throw error;
  }

  const chat = await getChatForUser(id, userId);

  if (!chat) {
    return notFound();
  }

  const view = await readBranches(id, userId, (await searchParams).branch);

  return (
    <Chat
      id={chat.id}
      title={chat.title}
      initialProjectId={chat.projectId ?? null}
      chatMessages={view.messages}
      initialBranchId={view.branchId}
      initialBranches={view.branches}
      initialRuns={view.runs}
      lastContext={chat.lastContext ?? undefined}
    />
  );
}
