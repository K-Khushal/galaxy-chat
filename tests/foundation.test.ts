import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { insertOwnedMessageBatch } from "../lib/actions/chat/chat-message";
import { runAuthorizedFundedModelCall } from "../lib/ai/authorized-model";
import { runFundedModelCall } from "../lib/ai/funded";
import { assertOwner } from "../lib/auth/access";
import {
  isInvitedLogin,
  parseInviteLogins,
  resolveAuthConfig,
} from "../lib/auth/env";
import { AppError } from "../lib/errors";

const secret = "x".repeat(32);

test("auth stays unconfigured when any required value is missing", () => {
  expect(
    resolveAuthConfig({
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      GITHUB_CLIENT_ID: "client",
      GITHUB_CLIENT_SECRET: "secret",
    }),
  ).toBeNull();
});

test("a short auth secret does not configure auth", () => {
  expect(
    resolveAuthConfig({
      BETTER_AUTH_SECRET: "too-short",
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      GITHUB_CLIENT_ID: "client",
      GITHUB_CLIENT_SECRET: "secret",
      DATABASE_URL: "postgres://example",
    }),
  ).toBeNull();
});

test("invite matching is explicit and case-insensitive", () => {
  const allowlist = parseInviteLogins("Octocat, hubot");
  expect(isInvitedLogin("octocat", allowlist)).toBe(true);
  expect(isInvitedLogin("other", allowlist)).toBe(false);
  expect(isInvitedLogin(null, allowlist)).toBe(false);
  expect(isInvitedLogin("octocat", [])).toBe(false);
});

test("ownership rejects a different user id", () => {
  expect(() => assertOwner("user-a", "user-b")).toThrow(AppError);
  expect(() => assertOwner("user-a", "user-a")).not.toThrow();
});

test("a mixed owned and unowned message batch is rejected before any write", async () => {
  let writes = 0;
  const rejected = insertOwnedMessageBatch(
    {
      insert: () => {
        writes += 1;
        return Promise.resolve([]);
      },
      ownedChatIds: () => Promise.resolve(["owned-chat"]),
    },
    [
      {
        attachments: [],
        chatId: "owned-chat",
        id: "message-owned",
        parts: [{ text: "hello", type: "text" }],
        role: "user",
      },
      {
        attachments: [],
        chatId: "other-chat",
        id: "message-other",
        parts: [{ text: "foreign", type: "text" }],
        role: "user",
      },
    ],
    "user-a",
  );
  await expect(rejected).rejects.toBeInstanceOf(AppError);
  expect(writes).toBe(0);
});

test("disabled funded inference does not reach the provider", async () => {
  let called = false;
  const rejected = runFundedModelCall(
    { OPENROUTER_API_KEY: "present-but-not-enough" },
    () => {
      called = true;
      return Promise.resolve("sent");
    },
  );
  await expect(rejected).rejects.toMatchObject({
    id: "funded_inference_disabled",
  });
  expect(called).toBe(false);
});

test("rejected auth cannot reach a funded title provider", async () => {
  let called = false;
  const rejected = runAuthorizedFundedModelCall({
    authorize: () => {
      throw new AppError("unauthenticated", 401);
    },
    env: {
      FUNDED_INFERENCE: "1",
      OPENROUTER_API_KEY: "present",
    },
    run: () => {
      called = true;
      return Promise.resolve("title");
    },
  });
  await expect(rejected).rejects.toMatchObject({ id: "unauthenticated" });
  expect(called).toBe(false);
});

test("baseline SQL revokes browser roles and avoids Supabase Auth helpers", () => {
  const sql = readFileSync("drizzle/0000_baseline.sql", "utf8");
  expect(sql.includes("auth.uid")).toBe(false);
  expect(sql.includes("ENABLE ROW LEVEL SECURITY")).toBe(true);
  expect(sql.includes("REVOKE ALL")).toBe(true);
  expect(sql.includes("anon")).toBe(true);
  expect(sql.includes("authenticated")).toBe(true);
  for (const table of [
    "user",
    "session",
    "account",
    "verification",
    "chat",
    "chat_message",
  ]) {
    expect(sql.includes(table)).toBe(true);
  }
});
