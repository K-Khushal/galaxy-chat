import { SignInPanel } from "@/components/auth/sign-in";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="flex min-h-dvh w-full items-center justify-center px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <SignInPanel notice={params.notice} />
    </div>
  );
}
