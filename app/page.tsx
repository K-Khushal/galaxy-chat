import type { Metadata } from "next";
import { Footer } from "@/components/home/footer";
import { Header } from "@/components/home/header";
import { HeroSection } from "@/components/home/hero-section";
import styles from "@/components/home/home.module.css";
import { HomeSections } from "@/components/home/home-sections";
import { publicSiteOrigin } from "@/lib/ui/public-site";

const origin = publicSiteOrigin(process.env.SITE_URL);
const title = "Galaxy Chat — a clear space for complex thoughts";
const description =
  "Work through code, shape a plan, or explore a question in a calm AI chat workspace. Saved conversations, branching, and an explicit choice of funding.";

export const metadata: Metadata = {
  title,
  description,
  ...(origin ? { alternates: { canonical: origin } } : {}),
  openGraph: {
    title,
    description,
    type: "website",
    siteName: "Galaxy Chat",
    ...(origin
      ? {
          url: origin,
          images: [
            {
              url: `${origin}/galaxy-social.png`,
              width: 1200,
              height: 630,
              alt: "Galaxy Chat. A clear space for complex thoughts.",
            },
          ],
        }
      : {}),
  },
  twitter: {
    card: origin ? "summary_large_image" : "summary",
    title,
    description,
    ...(origin ? { images: [`${origin}/galaxy-social.png`] } : {}),
  },
};

export default function Home() {
  return (
    <div className={styles.site}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <HeroSection />
        <HomeSections />
      </main>
      <Footer />
    </div>
  );
}
