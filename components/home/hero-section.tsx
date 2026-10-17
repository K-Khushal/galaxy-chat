import {
  ArrowUpRight,
  CornerDownRight,
  GitBranch,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { Message, MessageContent } from "@/components/elements/message";
import { Button } from "@/components/ui/button";
import styles from "./home.module.css";

export function HeroSection() {
  return (
    <section
      className={`${styles.container} ${styles.hero}`}
      aria-labelledby="hero-title"
    >
      <div className={styles.heroCopy}>
        <h1 id="hero-title">A clear space for complex thoughts.</h1>
        <p className={styles.intro}>
          Work through code, shape a plan, or follow a question. Keep your
          conversations together and choose how each request is funded.
        </p>
        <div className={styles.heroActions}>
          <Button asChild size="lg" className="rounded-full px-6">
            <Link href="/chat" prefetch={false}>
              Open your workspace <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
          <a className={styles.textLink} href="#workspace">
            Take a look around
          </a>
        </div>
        <p className={styles.entryNote}>
          An invite-only beta. Sign in with your invited GitHub account.
        </p>
      </div>
      <figure className={styles.previewFigure}>
        <div className={styles.preview}>
          <div className={styles.previewBar}>
            <span className={styles.previewTitle}>
              <Sparkles aria-hidden="true" className="size-4 text-primary" /> A
              project worth finishing
            </span>
            <span className={styles.previewBadge}>Example preview</span>
          </div>
          <div className={styles.previewBody}>
            <Message from="user" className="pt-0 pb-5">
              <MessageContent variant="flat">
                Help me scope a weekend API project. I tend to overbuild.
              </MessageContent>
            </Message>
            <div className={styles.answerHeading}>
              <Sparkles aria-hidden="true" className="size-4 text-primary" />
              <span>Galaxy</span>
            </div>
            <Message from="assistant" className="py-0">
              <MessageContent variant="flat" className="w-full">
                <p className={styles.previewLead}>
                  Start with one useful endpoint.
                </p>
                <p>
                  Pick a problem you have today. Build the smallest API that
                  solves it, then stop and use it.
                </p>
                <ul className={styles.previewList}>
                  <li>One input. One clear response.</li>
                  <li>A happy path and a helpful error.</li>
                  <li>A README your future self can follow.</li>
                </ul>
              </MessageContent>
            </Message>
            <div className={styles.branchNote}>
              <GitBranch aria-hidden="true" className="size-4" />
              <span>A different angle can become a new branch.</span>
            </div>
            <div className={styles.previewComposer}>
              <CornerDownRight aria-hidden="true" className="size-4" />
              <span>What would you explore next?</span>
            </div>
          </div>
        </div>
        <figcaption>
          Illustrative conversation using shared message components. Written for
          this preview; no model request or live response.
        </figcaption>
      </figure>
    </section>
  );
}
