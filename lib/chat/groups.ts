import type { ChatSummary } from "./store";
export function chatGroup(chat: ChatSummary, now = new Date()) {
  if (chat.pinned) return "Pinned";
  const date = new Date(chat.updatedAt);
  const day = (value: Date) =>
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const age = (day(now) - day(date)) / 86_400_000;
  if (age < 1) return "Today";
  if (age < 2) return "Yesterday";
  if (age < 7) return "Previous 7 days";
  if (age < 30) return "Previous 30 days";
  return date.toLocaleDateString("en", { month: "long", year: "numeric" });
}
export function sortedChats(chats: ChatSummary[]) {
  return [...chats].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.id.localeCompare(b.id),
  );
}
