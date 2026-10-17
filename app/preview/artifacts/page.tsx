import { notFound } from "next/navigation";
import { ArtifactFixture } from "@/components/artifacts/artifact-fixture";
import { uiHarnessEnabled } from "@/lib/ui/availability";
export const dynamic = "force-dynamic";
export default function ArtifactPreviewPage() {
  if (!uiHarnessEnabled(process.env)) notFound();
  return <ArtifactFixture />;
}
