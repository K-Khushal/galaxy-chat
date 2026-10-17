import { SignInPanel } from "@/components/auth/sign-in";
import { resolveAuthConfig } from "@/lib/auth/env";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="flex min-h-dvh w-full items-center justify-center px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <SignInPanel
        configured={resolveAuthConfig(process.env) !== null}
        notice={params.notice}
      />
    </div>
  );
}
