import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { JobsWorkbench } from "@/components/jobs/jobs-workbench";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";
export const dynamic = "force-dynamic";
export default async function Page() {
  try {
    await requireChatAccess(await headers());
  } catch (error) {
    if (error instanceof AppError) redirect(`/sign-in?notice=${error.id}`);
    throw error;
  }
  return <JobsWorkbench />;
}
