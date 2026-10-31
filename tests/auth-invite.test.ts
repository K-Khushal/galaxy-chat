import { expect, test } from "bun:test";
import { isInvitedLogin } from "../lib/auth/invite";

test("invite matching is explicit and case-insensitive", () => {
  const allowlist = ["octocat", "hubot"];
  expect(isInvitedLogin("Octocat", allowlist)).toBe(true);
  expect(isInvitedLogin("other", allowlist)).toBe(false);
  expect(isInvitedLogin(null, allowlist)).toBe(false);
  expect(isInvitedLogin("octocat", [])).toBe(false);
});
