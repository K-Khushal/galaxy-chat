import { SignInPanel } from "@/components/auth/sign-in";
import { resolveAuthConfig } from "@/lib/auth/env";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="flex min-h-[80vh] w-full items-center justify-center p-4">
      <SignInPanel
        configured={resolveAuthConfig(process.env) !== null}
        notice={params.notice}
      />
    </div>
  );
}
