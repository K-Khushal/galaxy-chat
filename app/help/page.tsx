import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage } from "@/components/home/info-page";

export const metadata: Metadata = {
  title: "Help & support — Galaxy Chat",
  description:
    "Sign-in, credits, provider keys, data controls, and support for the Galaxy Chat beta.",
};

export default function HelpPage() {
  return (
    <InfoPage
      title="A little help getting started."
      intro="Galaxy is an invite-only chat beta. This page explains the current entry flow and the limits you may encounter."
    >
      <section id="sign-in">
        <h2>Open your workspace</h2>
        <p>
          Use{" "}
          <Link href="/sign-in" prefetch={false}>
            sign-in
          </Link>{" "}
          with your invited GitHub account. If you already have a valid invited
          session,{" "}
          <Link href="/chat" prefetch={false}>
            open chat
          </Link>{" "}
          to continue. An invitation is checked by the server; a successful
          GitHub login alone does not grant access.
        </p>
        <p>
          If sign-in is unavailable, the administrator needs to finish
          authentication setup. If your account is not invited, contact the
          person who invited you. No public waitlist or separate support inbox
          is available yet.
        </p>
        <p>
          Open{" "}
          <Link href="/guest" prefetch={false}>
            guest chat
          </Link>{" "}
          to check availability for one bounded basic text generation. Service
          configuration, bot verification, quota, and shared funding apply, so
          generation may be unavailable. After your generation, sign in with an
          invited account to continue. The guest exchange is not saved to
          account history or transferred when you sign in.
        </p>
      </section>
      <section id="credits">
        <h2>Understand platform credits</h2>
        <p>
          One credit equals $0.10. Five daily credits represent a maximum $0.50
          allowance, resetting at 00:00 UTC with no rollover or cash value. The
          allowance is conditional on shared funding and an enabled service, so
          it does not guarantee available requests.
        </p>
        <p>
          Platform credits support only the configured basic text model. When
          your daily allowance or shared funding is exhausted, new platform
          requests pause. Unknown or expired model prices also pause access.
          Your workspace shows the server’s current state before sending.
        </p>
        <p>
          A stopped or interrupted request may already have incurred a provider
          charge. Uncertain usage can keep a reservation held until it is
          reconciled; stopping does not guarantee a refund or restore available
          funds.
        </p>
      </section>
      <section id="provider-keys">
        <h2>Use your own provider key</h2>
        <p>
          After signing in, open Account &amp; settings → Keys. Save an
          OpenRouter or Vercel AI Gateway key, then choose that provider under
          “Pay with” in the composer. Only the models configured for that route
          are available; key authentication is not proof of access to every
          model.
        </p>
        <p>
          Keys are encrypted on the server, masked after saving, and can be
          replaced or deleted. “Test key” checks authentication through a
          metadata endpoint without generating an answer. A failed test, missing
          configuration, or revoked key does not switch to platform funding.
        </p>
        <p>
          Your provider account pays its own charges. Messages go to that
          provider and its selected model host under their terms. BYOK does not
          deduct platform model credits, but service and concurrency limits
          remain. Set spending limits with the provider; Galaxy does not
          guarantee a maximum provider bill.
        </p>
      </section>
      <section>
        <h2>Find, branch, export, or delete</h2>
        <p>
          Search, rename, and delete saved conversations from history. Editing a
          prompt or regenerating an answer creates a new branch and preserves
          the original. Use the branch selector to revisit it.
        </p>
        <p>
          For export and account deletion, open Account &amp; settings →
          Account. Remove a saved key from the Keys tab.{" "}
          <Link href="/privacy">Read the data notice</Link> for provider and
          retained-record limitations.
        </p>
      </section>
      <section>
        <h2>Report a problem</h2>
        <p>
          For a general bug,{" "}
          <a href="https://github.com/K-Khushal/galaxy-chat/issues">
            open an issue on GitHub
          </a>{" "}
          with the error identifier, the action you tried, and your browser.
          GitHub issues are public. Never include provider keys, cookies,
          prompts, private conversations, or account exports.
        </p>
        <p>
          For a private account or data question, contact the person who invited
          you. A dedicated private support channel has not been set up.
        </p>
      </section>
      <section>
        <h2>What is still ahead?</h2>
        <p>
          Saved memory and projects, attachments, artifacts, tools, search, and
          browser work are roadmap features. This beta focuses on text chat.
          Live guest verification, provider behavior, deployment, and the
          release quality gate still require verification before public beta.
        </p>
      </section>
    </InfoPage>
  );
}
