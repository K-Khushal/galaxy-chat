import { createChatRoute, listChatsRoute } from "@/lib/api/chats";
import { route } from "@/lib/api/production";

export const GET = route(listChatsRoute);
export const POST = route(createChatRoute);
