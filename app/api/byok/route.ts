import { deleteByokRoute, getByokRoute, saveByokRoute } from "@/lib/api/byok";
import { route } from "@/lib/api/production";

export const GET = route(getByokRoute);
export const PUT = route(saveByokRoute);
export const DELETE = route(deleteByokRoute);
