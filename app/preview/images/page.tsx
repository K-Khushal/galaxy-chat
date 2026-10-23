import { notFound } from "next/navigation";
import { ImageFixture } from "@/components/artifacts/image-fixture";
import { uiHarnessEnabled } from "@/lib/ui/availability";
export const dynamic = "force-dynamic";
export default function ImageFixturePage() {
  if (!uiHarnessEnabled(process.env)) notFound();
  return <ImageFixture />;
}
