import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";

export { default } from "@/app/page";

// Same page as `/`, so the canonical URL is `/`.
export const metadata: Metadata = publicPageMetadata("/", "Sign in");
