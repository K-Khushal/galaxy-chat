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
      <section id="files">
        <h2>Ground a saved conversation in private files</h2>
        <p>
          After the first saved message, choose Add file in the composer. Text,
          Markdown, PNG, JPEG, WebP, and text PDFs are supported when private
          storage is enabled. Files are limited to 2 MiB each (text and
          Markdown: 128 KiB), PDFs to 12 pages, and extracted text to 24,000
          characters. Choose at most three files, then review Exact file
          context. Large selections may exceed the smaller request context
          limit; upload a shorter excerpt.
        </p>
        <p>
          Only checked files are sent with a request. Text and PDF excerpts
          include filename, attachment id, and page labels; they are untrusted
          source data, and answers can still be wrong. Images require an
          explicitly reviewed image-capable BYOK model. Platform funding
          supports text excerpts only. Scanned PDFs do not trigger OCR or paid
          extraction. Guests and temporary conversations cannot upload or use
          files.
        </p>
        <p>
          Cancel upload stops processing where possible. Delete removes the file
          from selection and queues its private object for cleanup. An uncertain
          upload can retain a storage reservation until the operator confirms
          that the remote write ended; a timeout or successful delete alone does
          not prove cancellation. Storage and daily transfer limits may pause
          new files. If private storage is unavailable, ordinary text chat still
          works when files are cleared.
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
      <section id="artifacts">
        <h2>Save an answer as an artifact</h2>
        <p>
          Under a saved assistant response, choose Create artifact, add a title,
          and select Markdown, HTML, or Chart from JSON. You can also reopen
          saved documents with Artifacts in the conversation header. Guest and
          temporary conversations cannot save artifacts.
        </p>
        <p>
          Edit the source and choose Save revision. History lets you restore a
          saved version as a new revision. The reading preview disables links,
          scripts, images, custom styles, and external resources. Download saves
          Markdown or HTML source as a text file; Galaxy does not run it.
        </p>
        <p>
          Charts accept a version 1 JSON spec for bar, line, area, or scatter
          plots, with a title, description, labeled axes, series, and rows.
          Preview includes an equivalent data table. Use null for missing
          values; at most eight series and 2,000 scalar value slots, including
          missing values, are allowed (scatter pairs, including missing pairs,
          count as two). Unknown fields, code, and remote data are rejected.
          Save a revision to download its chart JSON or inert SVG. Editing and
          rendering a chart do not call a model.
        </p>
        <p>
          Each artifact allows 128 KiB of source per revision and 40 revisions.
          Your account can store 50 artifacts and 8 MiB of revision source in
          total. Download a copy before deleting an artifact; deletion removes
          all of its revisions. Deleting its originating message, conversation,
          or account also removes the artifact.
        </p>
      </section>
      <section id="tools">
        <h2>Run bounded tools with your provider key</h2>
        <p>
          Open Tools to ask a reviewed BYOK model to use arithmetic or read the
          exact saved artifact revisions you select. If search is configured,
          you may separately authorize one exact Tavily query with its own key,
          price snapshot, ceiling, and privacy acknowledgement. A run allows up
          to three model steps and four tool calls within 20 seconds. Tool and
          search results are untrusted; browser, external write, connector, and
          code execution tools are unavailable.
        </p>
        <p>
          Choose the provider model and set an application cost ceiling at or
          above its estimate, then acknowledge that your provider still bills
          the key. The estimate and application ceiling cannot guarantee the
          provider bill, so keep provider spending controls enabled. If no
          reviewed model or usable key is configured, Tools stays off.
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
          In the workspace, Memory &amp; projects lets you explicitly create,
          edit, and delete reusable context and start grouped conversations.
          Request context shows exactly which memories and project instructions
          will be sent. Temporary conversation keeps its transcript out of saved
          history; provider retention and anonymous cost records are separate.
          Private attachment support requires configured storage and reviewed
          model capabilities. Artifacts can be created explicitly from saved
          assistant replies. Bounded tools require a reviewed BYOK model and
          provider spending controls. Optional bounded search requires separate
          Tavily funding and reviewed operator configuration. Browser work
          remains a roadmap feature. Live guest verification, provider behavior,
          deployment, and the release quality gate still require verification
          before public beta.
        </p>
      </section>
    </InfoPage>
  );
}
