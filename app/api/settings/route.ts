import { route } from "@/lib/api/production";
import { getSettingsRoute, saveSettingsRoute } from "@/lib/api/settings";
export const GET = route(getSettingsRoute);
export const PUT = route(saveSettingsRoute);
