import {
  deleteChatRoute,
  getChatRoute,
  updateChatRoute,
} from "@/lib/api/chats";
import { route } from "@/lib/api/production";

export const GET = route(getChatRoute);
export const PATCH = route(updateChatRoute);
export const DELETE = route(deleteChatRoute);
