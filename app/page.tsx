import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignInPanel } from "@/components/auth/sign-in";
import { getAuth } from "@/lib/auth/server";
import { authEnv, testE2eEnabled } from "@/lib/env";
export default async function Home() {
  if (testE2eEnabled()) {
    return (
      <main>
        <form action="/api/test-e2e/sign-in" method="POST">
          <button type="submit">E2E sign in</button>
        </form>
      </main>
    );
  }
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session) redirect("/chat");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <SignInPanel siteKey={authEnv().TURNSTILE_SITE_KEY} />
    </main>
  );
}
