import { notFound } from "next/navigation";
import { GuestPreview } from "@/components/guest/guest-preview";
import { AttachmentPreview } from "@/components/preview/attachment-preview";
import { ContextPreview } from "@/components/preview/context-preview";
import { ToolsPreview } from "@/components/preview/tools-preview";
import {
  PreviewCanvas,
  PreviewWorkbench,
} from "@/components/preview/ui-preview";
import { uiHarnessEnabled } from "@/lib/ui/availability";
import { isPreviewScenario } from "@/lib/ui/preview-fixtures";
export const dynamic = "force-dynamic";
export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (!uiHarnessEnabled(process.env)) notFound();
  const params = await searchParams;
  if (params.tools === "1") return <ToolsPreview />;
  if (params.attachments === "1") return <AttachmentPreview />;
  if (params.context === "1") return <ContextPreview />;
  if (params.guest) return <GuestPreview scenario={params.guest} />;
  if (params.canvas !== "1") return <PreviewWorkbench />;
  const scenario =
    params.state && isPreviewScenario(params.state) ? params.state : "empty";
  return (
    <PreviewCanvas
      key={`${scenario}-${params.theme}-${params.dialog}`}
      scenario={scenario}
      theme={params.theme ?? "system"}
      dialog={
        ["profile", "appearance", "security", "providers"].includes(
          params.dialog ?? "",
        )
          ? params.dialog
          : undefined
      }
      credit={params.credit}
    />
  );
}
