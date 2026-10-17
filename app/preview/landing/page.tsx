import { notFound } from "next/navigation";
import { LandingWorkbench } from "@/components/preview/landing-workbench";
import { uiHarnessEnabled } from "@/lib/ui/availability";

export const dynamic = "force-dynamic";

export default function LandingPreviewPage() {
  if (!uiHarnessEnabled(process.env)) notFound();
  return <LandingWorkbench />;
}
