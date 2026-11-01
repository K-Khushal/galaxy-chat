import type { Metadata } from "next";
import brand from "./brand.json";

/** Public identity of the site: one source for metadata, robots, sitemap and the manifest. */
export const SITE_URL = "https://galaxychat.tech";
export const SITE_NAME = "Galaxy Chat";
export const SITE_TAGLINE = "Your favourite AI models, together in one Chat.";

/** Pages a visitor can open without signing in. `/sign-in` duplicates `/`, so it is not listed. */
export const PUBLIC_PATHS = ["/", "/privacy", "/terms"] as const;

/** Prefixes crawlers must not request: the API and everything behind sign-in. */
export const PRIVATE_PATHS = [
  "/api/",
  "/chat",
  "/settings",
  "/design",
] as const;

// Colours for places CSS variables cannot reach: the browser's theme-color, the
// manifest and the generated images. Literals live in brand.json (checked
// against globals.css in tests/seo.test.ts); the UI itself only uses tokens.
/** Browser chrome colours, matching the page background of each theme. */
export const THEME_COLORS = brand.themeColor;
/** Brand mark colours: the indigo-violet accent and white from app/icon.svg. */
export const BRAND = { accent: brand.accent, mark: brand.mark } as const;

/** The generated share image (app/opengraph-image.tsx and app/twitter-image.tsx). */
export const SHARE_IMAGE = {
  width: 1200,
  height: 630,
  alt: `${SITE_NAME}. ${SITE_TAGLINE}`,
} as const;

/** Dark-theme text colours for the generated share image (--foreground and --muted-foreground). */
export const SHARE_TEXT = brand.shareText;

/** Canonical URL and share URL for a public page; the title comes from the page itself. */
export function publicPageMetadata(
  path: (typeof PUBLIC_PATHS)[number],
  title: string,
  description: string = SITE_TAGLINE,
): Metadata {
  const shareTitle = `${title} · ${SITE_NAME}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: shareTitle,
      description,
      url: path,
      locale: "en_US",
      // A page's own openGraph replaces the layout's, file-based image included.
      images: [{ url: "/opengraph-image", ...SHARE_IMAGE }],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description,
      images: [{ url: "/twitter-image", ...SHARE_IMAGE }],
    },
  };
}
