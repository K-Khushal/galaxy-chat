import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignInPanel } from "@/components/auth/sign-in";
import { getAuth } from "@/lib/auth/server";
import { authEnv } from "@/lib/env";
export default async function Home() {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session) redirect("/chat");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <SignInPanel siteKey={authEnv().TURNSTILE_SITE_KEY} />
    </main>
  );
}
