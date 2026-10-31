import { route } from "@/lib/api/production";
import { temporaryMessageRoute } from "@/lib/api/temporary";

export const maxDuration = 300;

export const POST = route(temporaryMessageRoute);
