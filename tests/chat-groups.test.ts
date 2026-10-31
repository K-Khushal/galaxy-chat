import { expect, test } from "bun:test";
import { chatGroup, sortedChats } from "../lib/chat/groups";
import type { ChatSummary } from "../lib/chat/store";

const now = new Date(2026, 9, 31, 12);
const row = (age: number, pinned = false) =>
  ({
    id: String(age),
    pinned,
    updatedAt: new Date(2026, 9, 31 - age, 12).toISOString(),
  }) as ChatSummary;
test("date groups and pinned ordering", () => {
  expect([0, 1, 3, 10, 40].map((age) => chatGroup(row(age), now))).toEqual([
    "Today",
    "Yesterday",
    "Previous 7 days",
    "Previous 30 days",
    "September 2026",
  ]);
  expect(chatGroup(row(40, true), now)).toBe("Pinned");
  expect(sortedChats([row(1), row(40, true), row(0)]).map((c) => c.id)).toEqual(
    ["40", "0", "1"],
  );
});
