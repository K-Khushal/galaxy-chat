import { sendMessageRoute } from "@/lib/api/chats";
import { route } from "@/lib/api/production";

// The Generation runs in after() within this budget; keep in sync with
// MAX_DURATION_SECONDS in lib/api/context.ts.
export const maxDuration = 300;

export const POST = route(sendMessageRoute);
