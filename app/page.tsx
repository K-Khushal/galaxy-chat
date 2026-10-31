import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";

// Temporary placeholder until the chat UI lands in M3.
export default async function Home() {
  const access = await requireAccess(await headers()).catch((error) => {
    if (error instanceof AppError && error.status < 500) {
      redirect(
        error.id === "invite_required"
          ? "/sign-in?notice=invite_required"
          : "/sign-in",
      );
    }
    throw error;
  });
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-medium tracking-tight">Galaxy Chat</h1>
      <p className="text-muted-foreground">
        Signed in as {access.name}. Chat is being rebuilt.
      </p>
      <SignOutButton />
    </main>
  );
}
