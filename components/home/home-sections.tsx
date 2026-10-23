import {
  ArrowUpRight,
  Check,
  GitBranch,
  KeyRound,
  Search,
  TextCursorInput,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import styles from "./home.module.css";

const features = [
  {
    icon: Search,
    title: "Find your way back",
    text: "Search saved conversations, give them a useful name, and pick up a thread when you need it.",
  },
  {
    icon: GitBranch,
    title: "Leave room for another answer",
    text: "Edit a prompt or regenerate in a new branch. Your original conversation stays intact.",
  },
  {
    icon: TextCursorInput,
    title: "Stay with the substance",
    text: "Turn a saved response into a Markdown, HTML, chart, or typed-table artifact. Edit its source, restore a revision, and download a copy.",
  },
];

export function HomeSections() {
  return (
    <>
      <section
        id="workspace"
        className={`${styles.container} ${styles.workspace}`}
        aria-labelledby="workspace-title"
      >
        <div className={styles.sectionHeading}>
          <h2 id="workspace-title">
            Keep the thread.
            <br />
            Change your angle.
          </h2>
          <p>
            A conversation is rarely a straight line. Galaxy gives your
            questions somewhere to go, and somewhere to come back to.
          </p>
        </div>
        <div className={styles.features}>
          {features.map(({ icon: Icon, title, text }) => (
            <article key={title}>
              <Icon aria-hidden="true" className="size-5 text-primary" />
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
        <p className={styles.roadmap}>
          <span>Implemented for the gated beta:</span> text conversations,
          explicit memory, projects, temporary chat, private attachments when
          storage is configured, versioned Markdown, HTML, chart, and
          typed-table artifacts, default-off image generation with a reviewed
          OpenRouter endpoint and your provider key, bounded tools with reviewed
          provider models, optional separately funded Tavily search when
          configured, and account controls. <span>Still ahead:</span> browser
          work.
        </p>
      </section>
      <section
        id="funding"
        className={`${styles.container} ${styles.funding}`}
        aria-labelledby="funding-title"
      >
        <div className={styles.sectionHeading}>
          <h2 id="funding-title">
            Your conversation.
            <br />
            Your choice of funding.
          </h2>
          <p>
            Choose platform credits or your own provider key before sending.
            Galaxy never silently switches who pays.
          </p>
        </div>
        <div className={styles.fundingGrid}>
          <article className={styles.platformPanel}>
            <p className={styles.panelLabel}>Platform credits</p>
            <h3>
              A daily allowance,
              <br />
              from a shared pool.
            </h3>
            <div className={styles.creditAmount}>
              <span>5 credits</span>
              <span>$0.50 per day</span>
            </div>
            <p>
              One credit is $0.10. The five-credit daily allowance resets at
              00:00 UTC, with no rollover or cash value.
            </p>
            <p>
              Available only while shared funding remains and the service is
              enabled. Basic text models only; a daily allowance does not
              guarantee available inference.
            </p>
            <Link className={styles.textLink} href="/help#credits">
              Understand credits{" "}
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </Link>
          </article>
          <article className={styles.keyPanel}>
            <KeyRound aria-hidden="true" className="size-6 text-primary" />
            <h3>Bring your own key.</h3>
            <p>
              Use your OpenRouter or Vercel AI Gateway key with the models
              configured for this workspace. Add, test, replace, or delete it in
              Account &amp; settings → Keys after signing in.
            </p>
            <p>
              Optional web search uses its own encrypted Tavily key, exact-query
              approval, and separate ceiling. Model keys and platform credits do
              not fund search.
            </p>
            <ul className={styles.keyList}>
              <li>
                <Check aria-hidden="true" className="size-4" />
                Encrypted on the server
              </li>
              <li>
                <Check aria-hidden="true" className="size-4" />
                No platform model credits deducted
              </li>
              <li>
                <Check aria-hidden="true" className="size-4" />
                An explicit choice on each request
              </li>
            </ul>
            <p className={styles.smallPrint}>
              Provider charges apply to your account. Your messages go to the
              selected provider and model host under their terms. Model access
              varies; service limits still apply. Set spending limits with your
              provider.
            </p>
            <Link className={styles.textLink} href="/help#provider-keys">
              How provider keys work{" "}
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </Link>
          </article>
        </div>
      </section>
      <section
        className={`${styles.container} ${styles.controlSection}`}
        aria-labelledby="control-title"
      >
        <div>
          <h2 id="control-title">A workspace you can leave with.</h2>
          <p>
            Export your account data, delete conversations, or delete your
            account from settings. Provider retention and operational records
            have separate limits.
          </p>
          <Link className={styles.textLink} href="/privacy">
            Read about your data{" "}
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <div className={styles.guestNote}>
          <h3>Just looking?</h3>
          <p>
            Try one bounded basic text response when guest access is available.
            Bot verification, quota, and shared funding apply; generation may be
            unavailable.
          </p>
          <p>
            Your guest exchange is not saved or transferred when you sign in.
            Continue with an invited account for saved conversations.
          </p>
          <Button
            asChild
            variant="outline"
            className="mt-2 rounded-full bg-card shadow-none"
          >
            <Link href="/guest" prefetch={false}>
              Try a guest prompt
            </Link>
          </Button>
        </div>
      </section>
      <section
        className={`${styles.container} ${styles.closing}`}
        aria-labelledby="closing-title"
      >
        <h2 id="closing-title">
          Bring a question.
          <br />
          See where it takes you.
        </h2>
        <div>
          <Button asChild size="lg" className="rounded-full px-6">
            <Link href="/chat" prefetch={false}>
              Open your workspace <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
          <p>
            Invite-only access. Availability depends on configuration and
            funding.
          </p>
        </div>
      </section>
    </>
  );
}
