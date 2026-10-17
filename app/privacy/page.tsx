import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage } from "@/components/home/info-page";

export const metadata: Metadata = {
  title: "Privacy & data — Galaxy Chat",
  description:
    "What Galaxy Chat stores, what providers receive, and how account export and deletion work.",
};

export default function PrivacyPage() {
  return (
    <InfoPage
      title="Your data, in plain terms."
      intro="This describes the current chat beta and its controls. Hosting, provider retention, and backup practices still need to be verified before a live beta release."
    >
      <section>
        <h2>What the workspace stores</h2>
        <p>
          Signed-in conversations are saved to your account, including prompts,
          answers, branches, titles, and request state. Account information
          includes your profile and GitHub login. Conversations are private to
          your account; this is not end-to-end encrypted chat.
        </p>
        <p>
          Saved memory, temporary chat, attachments, and artifact storage are
          not available in this beta. Avoid sharing sensitive information you do
          not want the application or your selected provider to process.
        </p>
      </section>
      <section>
        <h2>What a provider receives</h2>
        <p>
          When you send a model request, the selected provider and model host
          receive your prompt and a bounded recent conversation context. Their
          terms, retention, and processing policies apply. Choosing your own key
          means that provider account pays its charges.
        </p>
        <p>
          Provider keys are encrypted on the server and shown only as masked
          metadata after saving. They are not included in plaintext in account
          exports. Encryption at rest does not protect against a compromised
          application host or change a provider’s policies.
        </p>
      </section>
      <section>
        <h2>Export or delete your data</h2>
        <p>
          In your workspace, open Account &amp; settings → Account to export
          account data or delete the account. Export includes your profile,
          conversations, messages, branches, and safe usage and provider-key
          metadata. You can also delete individual conversations from history
          and remove provider keys in the Keys tab.
        </p>
        <p>
          Account deletion removes personal account records, saved chats, and
          saved provider keys. It does not recall a request that has already
          reached a provider, remove provider-held records, or promise immediate
          removal from backups.
        </p>
        <Link href="/chat" prefetch={false}>
          Open your workspace to manage data
        </Link>
      </section>
      <section>
        <h2>Operational records and cookies</h2>
        <p>
          Financial usage records and pseudonymous resource and abuse-prevention
          records may remain after account deletion to preserve spending limits,
          prevent replay, and investigate unfinished requests. Retained resource
          records do not contain prompt text or saved provider keys. No
          automatic retention period or complete deletion deadline is promised
          here.
        </p>
        <p>
          Authentication uses session cookies. The{" "}
          <Link href="/guest" prefetch={false}>
            guest page
          </Link>{" "}
          checks current availability. Configured guest access uses a signed
          guest cookie and bot checks, and depends on quota and shared funding.
          The guest exchange is not saved to account history or transferred when
          you sign in. Cookie resets and other devices mean anonymous identity
          cannot prove one real person.
        </p>
        <p>
          Operational errors use stable error identifiers. Live hosting logs,
          backups, restore procedures, and provider-specific retention still
          need confirmation before release.
        </p>
      </section>
      <section>
        <h2>Questions or a data-control problem?</h2>
        <p>
          Contact the person who invited you for private account help. For a
          general bug,{" "}
          <a href="https://github.com/K-Khushal/galaxy-chat/issues">
            open a GitHub issue
          </a>
          . Issues are public: do not include prompts, API keys, cookies,
          account exports, or other private data.
        </p>
        <p>
          <Link href="/help">Read help &amp; support</Link>
        </p>
      </section>
    </InfoPage>
  );
}
