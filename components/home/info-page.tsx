import Link from "next/link";
import type { ReactNode } from "react";
import { Footer } from "./footer";
import { Header } from "./header";
import styles from "./home.module.css";

export function InfoPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.site}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" className={`${styles.container} ${styles.infoPage}`}>
        <Link className={styles.textLink} href="/">
          Back to Galaxy
        </Link>
        <h1>{title}</h1>
        <p className={styles.infoIntro}>{intro}</p>
        <div className={styles.infoContent}>{children}</div>
      </main>
      <Footer />
    </div>
  );
}
