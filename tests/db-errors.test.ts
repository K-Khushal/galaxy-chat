import { expect, test } from "bun:test";
import { isUniqueViolation } from "../lib/db/errors";
import { message } from "../lib/db/schema";
import {
  closeHarnesses,
  createHarness,
  PGLITE_SETUP_TIMEOUT_MS,
  warmDatabase,
} from "./support/harness";

test("matches unique violations by code, on the error or its cause", () => {
  expect(
    isUniqueViolation(Object.assign(new Error("x"), { code: "23505" })),
  ).toBe(true);
  expect(
    isUniqueViolation(
      new Error("Failed query", {
        cause: Object.assign(new Error("y"), { code: "23505" }),
      }),
    ),
  ).toBe(true);
});

test("ignores other errors, even ones that mention duplicates", () => {
  expect(
    isUniqueViolation(
      new Error("duplicate key value violates unique constraint"),
    ),
  ).toBe(false);
  expect(
    isUniqueViolation(Object.assign(new Error("fk"), { code: "23503" })),
  ).toBe(false);
  expect(isUniqueViolation(null)).toBe(false);
  expect(isUniqueViolation("23505")).toBe(false);
});

test(
  "recognises a real unique violation from the database driver",
  async () => {
    await warmDatabase();
    const h = await createHarness();
    try {
      await h.addUser("alice");
      await h.pg.exec(
        `INSERT INTO chat (id, user_id, model) VALUES ('c1', 'alice', 'm')`,
      );
      const row = {
        id: "dup",
        chatId: "c1",
        role: "user" as const,
        parts: [],
        status: "complete" as const,
      };
      await h.db.insert(message).values(row);
      const error = await h.db
        .insert(message)
        .values(row)
        .then(
          () => null,
          (e) => e,
        );
      expect(isUniqueViolation(error)).toBe(true);
    } finally {
      await closeHarnesses();
    }
  },
  PGLITE_SETUP_TIMEOUT_MS,
);
