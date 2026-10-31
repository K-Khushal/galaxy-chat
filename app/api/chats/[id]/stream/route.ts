import { resumeStreamRoute } from "@/lib/api/chats";
import { route } from "@/lib/api/production";

// A resumed stream follows the Generation until it ends.
export const maxDuration = 300;

export const GET = route(resumeStreamRoute);
