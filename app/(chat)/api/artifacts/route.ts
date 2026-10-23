import { chartSvg } from "@/lib/artifacts/chart-export";
import { parseChartSource } from "@/lib/artifacts/chart-spec";
import {
  artifactFilename,
  artifactIdentifier,
  artifactLimits,
} from "@/lib/artifacts/contract";
import {
  listArtifacts,
  mutateArtifact,
  readArtifact,
} from "@/lib/artifacts/service";
import { tableDownloadResponse } from "@/lib/artifacts/table-download";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { assertSameOrigin } from "@/lib/http/origin";

const privateHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const download = params.get("download");
    if (download === "csv" || download === "xlsx")
      return tableDownloadResponse(request);
    const access = await requireChatAccess(request.headers);
    const id = params.get("id");
    if (id && !artifactIdentifier.safeParse(id).success)
      throw new AppError("not_found", 404);
    if (id) {
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
              document.kind === "chart" ||
              document.kind === "table" ||
              document.kind === "image"
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
