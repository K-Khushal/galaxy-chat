import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignInPanel } from "@/components/auth/sign-in";
import { getAuth } from "@/lib/auth/server";
import { authEnv, testE2eEnabled } from "@/lib/env";
import {
  publicPageMetadata,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
} from "@/lib/site";

const homeTitle = `${SITE_NAME} · ${SITE_TAGLINE}`;
const home = publicPageMetadata("/", SITE_NAME);
export const metadata: Metadata = {
  ...home,
  title: { absolute: homeTitle },
  openGraph: { ...home.openGraph, title: homeTitle },
  twitter: { ...home.twitter, title: homeTitle },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_TAGLINE,
  inLanguage: "en",
};

export default async function Home() {
  if (testE2eEnabled()) {
    return (
      <main>
        <SignInPanel siteKey="e2e" />
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
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[60dvh] bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_12%,transparent),transparent)]"
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: A JSON data block is never executed, so the CSP nonce does not apply; `<` is escaped against injection.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <SignInPanel siteKey={authEnv().TURNSTILE_SITE_KEY} />
    </main>
  );
}
