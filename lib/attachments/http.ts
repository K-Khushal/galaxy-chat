import { NextResponse } from "next/server";
import { AttachmentService } from "@/lib/attachments/service";
import { requireChatAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http/error-response";
import { assertSameOrigin } from "@/lib/http/origin";

function attachmentError(error: unknown, id: string) {
  const response = errorResponse(error, id);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
function idFrom(request: Request, name: string) {
  const id = new URL(request.url).searchParams.get(name);
  if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id))
    throw new AppError("invalid_attachment", 400);
  return id;
}
export function attachmentHandlers(
  deps = { access: requireChatAccess, service: () => new AttachmentService() },
) {
  return {
    GET: async (request: Request) => {
      try {
        const access = await deps.access(request.headers);
        const service = deps.service();
        if (new URL(request.url).searchParams.get("download") === "1") {
          const { bytes, name } = await service.download(
            access.userId,
            idFrom(request, "id"),
            request.signal,
          );
          return new Response(new Uint8Array(bytes).buffer, {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`,
              "Content-Length": String(bytes.length),
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "sandbox; default-src 'none'",
              "Referrer-Policy": "no-referrer",
            },
          });
        }
        return NextResponse.json(
          {
            attachments: await service.list(
              access.userId,
              idFrom(request, "chatId"),
            ),
          },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      } catch (error) {
        return attachmentError(error, "attachment_request_failed");
      }
    },
    POST: async (request: Request) => {
      try {
        assertSameOrigin(request);
        const access = await deps.access(request.headers);
        return NextResponse.json(
          {
            attachment: await deps
              .service()
              .upload(access.userId, idFrom(request, "chatId"), request),
          },
          { status: 201, headers: { "Cache-Control": "private, no-store" } },
        );
      } catch (error) {
        return attachmentError(error, "attachment_upload_failed");
      }
    },
    DELETE: async (request: Request) => {
      try {
        assertSameOrigin(request);
        const access = await deps.access(request.headers);
        return NextResponse.json(
          await deps.service().remove(access.userId, idFrom(request, "id")),
          { headers: { "Cache-Control": "private, no-store" } },
        );
      } catch (error) {
        return attachmentError(error, "attachment_delete_failed");
      }
    },
  };
}
