import { presignRoute } from "@/lib/api/attachments";
import { route } from "@/lib/api/production";

export const POST = route(presignRoute);
