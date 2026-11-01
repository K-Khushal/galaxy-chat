import { ImageResponse } from "next/og";
import {
  BRAND,
  SHARE_IMAGE,
  SHARE_TEXT,
  SITE_NAME,
  SITE_TAGLINE,
  THEME_COLORS,
} from "@/lib/site";

export const alt = SHARE_IMAGE.alt;
export const size = { width: SHARE_IMAGE.width, height: SHARE_IMAGE.height };
export const contentType = "image/png";

// Satori cannot read CSS variables, so this uses the brand constants in lib/site.ts.
export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 96,
        gap: 40,
        background: THEME_COLORS.dark,
        color: SHARE_TEXT.foreground,
      }}
    >
      <svg width="128" height="128" viewBox="0 0 64 64" role="img">
        <title>{SITE_NAME}</title>
        <rect width="64" height="64" rx="18" fill={BRAND.accent} />
        <path
          d="m32 12 5.8 14.2L52 32l-14.2 5.8L32 52l-5.8-14.2L12 32l14.2-5.8Z"
          fill={BRAND.mark}
        />
        <circle cx="49" cy="14" r="4" fill={BRAND.mark} />
      </svg>
      <div style={{ display: "flex", fontSize: 96, fontWeight: 700 }}>
        {SITE_NAME}
      </div>
      <div style={{ display: "flex", fontSize: 44, color: SHARE_TEXT.muted }}>
        {SITE_TAGLINE}
      </div>
    </div>,
    size,
  );
}
