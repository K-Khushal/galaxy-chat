import { Sparkles } from "lucide-react";
import Link from "next/link";
import { ThemeControl } from "@/components/shell/theme-control";
import styles from "./home.module.css";

export function Footer() {
  return (
    <footer className={`${styles.container} ${styles.footer}`}>
      <div>
        <Link href="/" className={styles.brand}>
          <Sparkles aria-hidden="true" className="size-5 text-primary" />
          Galaxy Chat
        </Link>
        <p>Space to think things through.</p>
      </div>
      <nav aria-label="Footer navigation">
        <Link href="/privacy">Privacy &amp; data</Link>
        <Link href="/help">Help &amp; support</Link>
        <a href="https://github.com/K-Khushal/galaxy-chat">Source on GitHub</a>
      </nav>
      <div className={styles.appearance}>
        <ThemeControl />
      </div>
    </footer>
  );
}
