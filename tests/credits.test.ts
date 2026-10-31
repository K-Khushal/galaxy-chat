import { afterEach, beforeEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  type CreditsDb,
  getCredits,
  grantSignupCredits,
  hashGrantIdentity,
  refundCredit,
  SIGNUP_CREDITS,
  spendCredit,
} from "../lib/credits";
import * as schema from "../lib/db/schema";

const KEY = "test-key-test-key-test-key-test-key";
let client: PGlite;
let db: CreditsDb;

async function addUser(id: string) {
  await client.query(
    `INSERT INTO "user" (id, name, email) VALUES ($1, $1, $2)`,
    [id, `${id}@example.com`],
  );
}

beforeEach(async () => {
  client = await PGlite.create();
  for (const file of ["0000_auth.sql", "0001_credits.sql"]) {
    await client.exec(await Bun.file(resolve("drizzle", file)).text());
  }
  db = drizzle(client, { schema }) as unknown as CreditsDb;
});

afterEach(async () => {
  await client?.close();
});

test("new identity gets the sign-up Credits once", async () => {
  await addUser("u1");
  const hashes = [hashGrantIdentity({ kind: "email", value: "A@x.com" }, KEY)];
  expect(await grantSignupCredits(db, "u1", hashes)).toBe(SIGNUP_CREDITS);
  expect(await grantSignupCredits(db, "u1", hashes)).toBe(0);
  expect(await getCredits(db, "u1")).toBe(SIGNUP_CREDITS);
});

test("returning identity after account deletion gets 0 Credits", async () => {
  await addUser("u1");
  const email = hashGrantIdentity({ kind: "email", value: "a@x.com" }, KEY);
  await grantSignupCredits(db, "u1", [email]);
  await client.query(`DELETE FROM "user" WHERE id = 'u1'`);
  await addUser("u2");
  const github = hashGrantIdentity({ kind: "github", value: "123" }, KEY);
  // Email normalisation: same address in a different case.
  const again = hashGrantIdentity({ kind: "email", value: " A@X.com " }, KEY);
  expect(again).toBe(email);
  expect(await grantSignupCredits(db, "u2", [again, github])).toBe(0);
  expect(await getCredits(db, "u2")).toBe(0);
});

test("spend stops at zero and refund returns a credit", async () => {
  await addUser("u1");
  await grantSignupCredits(db, "u1", [
    hashGrantIdentity({ kind: "google", value: "g" }, KEY),
  ]);
  for (let i = 0; i < SIGNUP_CREDITS; i++) {
    expect(await spendCredit(db, "u1")).toBe(true);
  }
  expect(await spendCredit(db, "u1")).toBe(false);
  await refundCredit(db, "u1");
  expect(await getCredits(db, "u1")).toBe(1);
});

test("concurrent spends never go below zero", async () => {
  await addUser("u1");
  await grantSignupCredits(db, "u1", [
    hashGrantIdentity({ kind: "email", value: "c@x.com" }, KEY),
  ]);
  const results = await Promise.all(
    Array.from({ length: 15 }, () => spendCredit(db, "u1")),
  );
  expect(results.filter(Boolean).length).toBe(SIGNUP_CREDITS);
  expect(await getCredits(db, "u1")).toBe(0);
});

test("no identities means no Credits", async () => {
  await addUser("u1");
  expect(await grantSignupCredits(db, "u1", [])).toBe(0);
  expect(await getCredits(db, "u1")).toBe(0);
});

test("linking retains provider identities without another grant", async () => {
  await addUser("u1");
  const email = hashGrantIdentity(
    { kind: "email", value: "one@example.com" },
    KEY,
  );
  const provider = hashGrantIdentity(
    { kind: "github", value: "linked-id" },
    KEY,
  );
  await grantSignupCredits(db, "u1", [email]);
  expect(await grantSignupCredits(db, "u1", [email, provider])).toBe(0);
  expect(await getCredits(db, "u1")).toBe(10);
  await client.query('DELETE FROM "user" WHERE id = $1', ["u1"]);
  await addUser("u2");
  expect(await grantSignupCredits(db, "u2", [provider])).toBe(0);
});

test("concurrent grants of the same identity award only once", async () => {
  await addUser("u1");
  await addUser("u2");
  const hash = hashGrantIdentity({ kind: "google", value: "shared-id" }, KEY);
  const grants = await Promise.all([
    grantSignupCredits(db, "u1", [hash]),
    grantSignupCredits(db, "u2", [hash]),
  ]);
  expect(grants.sort()).toEqual([0, 10]);
});
