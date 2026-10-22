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
          Memories are saved only when you explicitly add or edit them in Memory
          &amp; projects. You choose the exact memories for each request;
          project instructions apply only inside that project. Temporary chat
          keeps its transcript in the tab and never creates saved conversations,
          titles, messages, or memories. Anonymous cost and resource records
          remain. Your provider’s retention policy still applies.
        </p>
        <p>
          Artifacts are saved only when you explicitly create one from a saved
          assistant response. Galaxy stores its source, immutable revisions, and
          links to the originating conversation and message. Previewing an
          artifact does not contact a model or load external resources, and
          artifact source is not automatically added to model context. Guest and
          temporary exchanges cannot create saved artifacts.
        </p>
        <p>
          Typed table CSV and XLSX files are generated only when an invited
          owner downloads a selected immutable revision. The generated file is
          returned as a private, non-cached attachment and is not retained as a
          new storage object. CSV may add a leading tab to formula-like text;
          the saved source revision is not changed.
        </p>
      </section>
      <section>
        <h2>Generated images</h2>
        <p>
          When an operator enables reviewed image generation and you explicitly
          choose Generate, Galaxy sends your prompt to OpenRouter and the
          selected provider using your saved key. Your provider key pays.
          Provider processing and retention policies apply. Galaxy stores your
          private prompt, reviewed model and price snapshot, request state,
          immutable provenance, and canonical PNG in private storage. Guest and
          temporary exchanges cannot save images. Editing and masks are
          unavailable.
        </p>
        <p>
          Exports include generation and object metadata, digests, and
          provenance; image bytes are downloaded separately through the owned
          revision control. Exports contain no provider key, binary image body,
          or signed storage URL. Artifact, message, conversation, and account
          deletion queue private object cleanup. Unresolved writes may need
          repeated cleanup, and anonymous provider holds survive deletion.
          Cancellation cannot recall entered provider work or guarantee its
          bill. Live provider and hosted storage verification remains pending;
          image generation is disabled by default.
        </p>
      </section>
      <section>
        <h2>Private files and extracted context</h2>
        <p>
          When enabled, files uploaded to a saved conversation live in a private
          storage bucket. Galaxy stores owned metadata and bounded extracted
          text. Downloads require an invited account and ownership checks;
          short-lived signed access stays inside the server. Files are
          downloaded as attachments, without an inline active-content viewer.
          This is not end-to-end encrypted storage.
        </p>
        <p>
          Only checked files are included with a model request. Review the exact
          text excerpts, filenames, attachment ids, and PDF page labels in the
          composer. Images are sent as original bytes only to an explicitly
          reviewed image-capable model. No automatic OCR runs. Files are
          unavailable to guests and temporary conversations.
        </p>
        <p>
          Deleting a file or conversation queues the underlying private objects
          for cleanup. Prior answers, quotations, and source references in saved
          messages remain until those messages or conversations are deleted.
          Interrupted writes can retain anonymous object and capacity records
          until a confirmed terminal outcome or operator reconciliation. Storage
          outages can delay cleanup; no immediate deletion deadline is promised.
        </p>
      </section>
      <section>
        <h2>What a provider receives</h2>
        <p>
          When you send a model request, the selected provider and model host
          receive your prompt, bounded recent conversation context, and the
          memories and project instructions shown in Request context, plus
          checked file excerpts or approved image bytes shown in Exact file
          context. Their terms, retention, and processing policies apply.
          Choosing your own key means that provider account pays its charges.
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
          conversations, messages, branches, explicit memories, projects,
          artifacts and all of their revisions, attachment metadata and
          extracted text, and safe usage and provider-key metadata. Original
          file bytes are downloaded separately through the owned file controls.
          Exports never include storage credentials or signed URLs. You can also
          delete individual conversations from history and remove provider keys
          in the Keys tab.
        </p>
        <p>
          Account deletion removes personal account records, saved chats,
          memories, projects, artifacts and their revisions, and saved provider
          keys, and queues private file deletion. Anonymous cleanup records can
          remain while a remote write is unresolved. Deleting an originating
          conversation or message also removes its linked artifacts. It does not
          recall a request that has already reached a provider, remove
          provider-held records, or promise immediate removal from backups.
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
