import "server-only";
import {
  artifactIdentifier,
  artifactLimits,
  tableExportFilename,
} from "@/lib/artifacts/contract";
import { readArtifactRevision } from "@/lib/artifacts/service";
import { tableCsv } from "@/lib/artifacts/table-csv";
import {
  parseTableSource,
  type TableSpec,
  tableExportFits,
} from "@/lib/artifacts/table-spec";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { privateDownloadHeaders } from "@/lib/http/private-download";

type TableExportFormat = "csv" | "xlsx";
type TableExportGenerator = (
  format: TableExportFormat,
  spec: TableSpec,
) => Uint8Array | Promise<Uint8Array>;

async function generateTableExport(format: TableExportFormat, spec: TableSpec) {
  return format === "csv"
    ? tableCsv(spec)
    : (await import("@/lib/artifacts/table-xlsx")).tableXlsx(spec);
}

export async function tableDownloadResponse(
  request: Request,
  generate: TableExportGenerator = generateTableExport,
) {
  try {
    const access = await requireChatAccess(request.headers);
    const params = new URL(request.url).searchParams;
    const id = params.get("id") ?? "";
    if (!artifactIdentifier.safeParse(id).success)
      throw new AppError("not_found", 404);
    const format = params.get("download");
    if (format !== "csv" && format !== "xlsx")
      throw new AppError("invalid_artifact", 400);
    const rawVersion = params.get("version") ?? "";
    if (!/^[1-9]\d*$/.test(rawVersion))
      throw new AppError("invalid_artifact", 400);
    const version = Number(rawVersion);
    if (!Number.isSafeInteger(version) || version > artifactLimits.revisions)
      throw new AppError("invalid_artifact", 400);
    const revision = await readArtifactRevision(access.userId, id, version);
    if (revision.kind !== "table") throw new AppError("invalid_artifact", 400);
    const parsed = parseTableSource(revision.content);
    if (!parsed.success) throw new AppError("invalid_artifact", 400);
    const bytes = await generate(format, parsed.data);
    if (!tableExportFits(bytes))
      throw new AppError("artifact_export_limit", 413);
    const filename = tableExportFilename(
      revision.title,
      revision.version,
      format,
    );
    return new Response(bytes.slice().buffer, {
      headers: privateDownloadHeaders({
        contentType:
          format === "csv"
            ? "text/csv; charset=utf-8; header=present"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename,
        fallback: filename,
        length: bytes.byteLength,
      }),
    });
  } catch (error) {
    return errorResponse(error, "artifacts_failed");
  }
}
