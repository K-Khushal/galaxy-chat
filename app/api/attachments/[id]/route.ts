import { deleteAttachmentRoute, viewRoute } from "@/lib/api/attachments";
import { route } from "@/lib/api/production";

export const GET = route(viewRoute);
export const DELETE = route(deleteAttachmentRoute);
