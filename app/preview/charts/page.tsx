import { notFound } from "next/navigation";
import { ChartFixture } from "@/components/artifacts/chart-fixture";
import { uiHarnessEnabled } from "@/lib/ui/availability";
export const dynamic = "force-dynamic";
export default function ChartFixturePage() {
  if (!uiHarnessEnabled(process.env)) notFound();
  return <ChartFixture />;
}
