import { z } from "zod";
import { readBounded } from "@/lib/attachments/content";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { assertSameOrigin } from "@/lib/http/origin";
import { privateDownloadHeaders } from "@/lib/http/private-download";
import { ImageService } from "./service";

const headers = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};
function failed(error: unknown) {
  const response = errorResponse(error, "image_request_failed");
  for (const [key, value] of Object.entries(headers))
    response.headers.set(key, value);
  return response;
}
export function imageHandlers(
  deps = { access: requireChatAccess, service: () => new ImageService() },
) {
  return {
    GET: async (request: Request) => {
      try {
        const access = await deps.access(request.headers),
          params = new URL(request.url).searchParams,
          service = deps.service();
        const id = params.get("requestId");
        if (id) {
          if (!z.uuid().safeParse(id).success)
            throw new AppError("not_found", 404);
          return Response.json(await service.status(access.userId, id), {
            headers,
          });
        }
        return Response.json(await service.catalog(access.userId), { headers });
      } catch (error) {
        return failed(error);
      }
    },
    POST: async (request: Request) => {
      try {
        assertSameOrigin(request);
        const access = await deps.access(request.headers);
        const bytes = await readBounded(request.body, 16_384, request.signal);
        let raw: unknown;
        try {
          raw = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
        } catch {
          throw new AppError("invalid_image_request", 400);
        }
        const cancel = z
          .object({ action: z.literal("cancel"), requestId: z.uuid() })
          .strict()
          .safeParse(raw);
        const service = deps.service();
        return Response.json(
          cancel.success
            ? await service.cancel(access.userId, cancel.data.requestId)
            : await service.generate(access.userId, raw, request.signal),
          { headers },
        );
      } catch (error) {
        return failed(error);
      }
    },
    object: async (request: Request) => {
      try {
        const access = await deps.access(request.headers),
          params = new URL(request.url).searchParams;
        const id = params.get("id"),
          version = params.get("version");
        if (
          !id ||
          id.length > 200 ||
          !version ||
          !/^(?:[1-9]|[1-3][0-9]|40)$/.test(version)
        )
          throw new AppError("not_found", 404);
        const { bytes, title } = await deps
          .service()
          .download(access.userId, id, Number(version), request.signal);
        return new Response(new Uint8Array(bytes).buffer, {
          headers: privateDownloadHeaders({
            contentType: "image/png",
            filename: `${title}-v${version}.png`,
            fallback: `image-v${version}.png`,
            length: bytes.length,
          }),
        });
      } catch (error) {
        return failed(error);
      }
    },
  };
}
