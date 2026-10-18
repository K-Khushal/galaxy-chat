import { chartSvg } from "@/lib/artifacts/chart-export";
import { parseChartSource } from "@/lib/artifacts/chart-spec";
import {
  artifactFilename,
  artifactIdentifier,
  artifactLimits,
  tableExportFilename,
} from "@/lib/artifacts/contract";
import {
  listArtifacts,
  mutateArtifact,
  readArtifact,
  readArtifactRevision,
} from "@/lib/artifacts/service";
import { tableCsv } from "@/lib/artifacts/table-csv";
import { parseTableSource, tableExportFits } from "@/lib/artifacts/table-spec";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { assertSameOrigin } from "@/lib/http/origin";
import { privateDownloadHeaders } from "@/lib/http/private-download";

const privateHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};
export async function GET(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id && !artifactIdentifier.safeParse(id).success)
      throw new AppError("not_found", 404);
    if (id) {
      const download = params.get("download");
      if (download === "csv" || download === "xlsx") {
        const rawVersion = params.get("version") ?? "";
        if (!/^[1-9]\d*$/.test(rawVersion))
          throw new AppError("invalid_artifact", 400);
        const version = Number(rawVersion);
        if (
          !Number.isSafeInteger(version) ||
          version > artifactLimits.revisions
        )
          throw new AppError("invalid_artifact", 400);
        const revision = await readArtifactRevision(access.userId, id, version);
        if (revision.kind !== "table")
          throw new AppError("invalid_artifact", 400);
        const parsed = parseTableSource(revision.content);
        if (!parsed.success) throw new AppError("invalid_artifact", 400);
        const bytes =
          download === "csv"
            ? tableCsv(parsed.data)
            : (await import("@/lib/artifacts/table-xlsx")).tableXlsx(
                parsed.data,
              );
        if (!tableExportFits(bytes))
          throw new AppError("artifact_export_limit", 413);
        const filename = tableExportFilename(
          revision.title,
          revision.version,
          download,
        );
        return new Response(bytes.slice().buffer, {
          headers: privateDownloadHeaders({
            contentType:
              download === "csv"
                ? "text/csv; charset=utf-8; header=present"
                : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename,
            fallback: filename,
            length: bytes.byteLength,
          }),
        });
      }
      const document = await readArtifact(access.userId, id);
      if (
        document.kind === "chart" &&
        download &&
        !parseChartSource(document.content).success
      )
        throw new AppError("invalid_artifact", 400);
      if (download === "svg") {
        if (document.kind !== "chart")
          throw new AppError("invalid_artifact", 400);
        const svg = chartSvg(document.content);
        if (!svg) throw new AppError("invalid_artifact", 400);
        return new Response(svg, {
          headers: {
            ...privateHeaders,
            "content-type": "image/svg+xml; charset=utf-8",
            "content-disposition": `attachment; filename="${artifactFilename(document.title, "chart").replace(/\.chart\.json$/, ".svg")}"`,
            "content-security-policy": "default-src 'none'; sandbox",
          },
        });
      }
      if (params.get("download") === "source")
        return new Response(document.content, {
          headers: {
            ...privateHeaders,
            "content-type":
              document.kind === "chart" || document.kind === "table"
                ? "application/json; charset=utf-8"
                : "text/plain; charset=utf-8",
            "content-disposition": `attachment; filename="${artifactFilename(document.title, document.kind)}"`,
            "content-security-policy": "default-src 'none'; sandbox",
          },
        });
      return Response.json(document, { headers: privateHeaders });
    }
    const chatId = params.get("chatId") ?? "";
    if (!artifactIdentifier.safeParse(chatId).success)
      throw new AppError("not_found", 404);
    return Response.json(
      {
        artifacts: await listArtifacts(access.userId, chatId),
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(error, "artifacts_failed");
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const access = await requireChatAccess(request.headers);
    // Bound the stream before JSON parsing, including chunked requests.
    const reader = request.body?.getReader();
    if (!reader) throw new AppError("invalid_artifact", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > artifactLimits.requestBytes) {
          await reader.cancel();
          throw new AppError("invalid_artifact", 413);
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let body: unknown;
    try {
      body = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new AppError("invalid_artifact", 400);
    }
    return Response.json(await mutateArtifact(access.userId, body), {
      headers: privateHeaders,
    });
  } catch (error) {
    return errorResponse(error, "artifacts_failed");
  }
}
