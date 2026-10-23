import { notFound } from "next/navigation";
import { TableFixture } from "@/components/artifacts/table-fixture";
import { uiHarnessEnabled } from "@/lib/ui/availability";

export const dynamic = "force-dynamic";

export default function TableFixturePage() {
  if (!uiHarnessEnabled(process.env)) notFound();
  return <TableFixture />;
}
