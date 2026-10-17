import { Sparkles } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import styles from "./home.module.css";

export function Header() {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="Galaxy Chat home">
        <span className={styles.brandMark}>
          <Sparkles aria-hidden="true" className="size-5" />
        </span>
        Galaxy Chat
      </Link>
      <nav className={styles.navigation} aria-label="Main navigation">
        <Link href="/#workspace">The workspace</Link>
        <Link href="/#funding">Funding</Link>
        <Link href="/help">Help</Link>
      </nav>
      <Button
        asChild
        variant="outline"
        className="rounded-full bg-card px-5 shadow-none"
      >
        <Link href="/sign-in" prefetch={false}>
          Sign in
        </Link>
      </Button>
    </header>
  );
}
