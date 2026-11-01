import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/site";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex" }}>
      <svg width="180" height="180" viewBox="0 0 64 64" role="img">
        <title>Galaxy</title>
        <rect width="64" height="64" fill={BRAND.accent} />
        <path
          d="m32 12 5.8 14.2L52 32l-14.2 5.8L32 52l-5.8-14.2L12 32l14.2-5.8Z"
          fill={BRAND.mark}
        />
        <circle cx="49" cy="14" r="4" fill={BRAND.mark} />
      </svg>
    </div>,
    size,
  );
}
