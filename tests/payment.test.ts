import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { saveByokKey } from "../lib/byok/store";
import { getCredits, spendCredit } from "../lib/credits";
import { payForReply, spendForReply } from "../lib/generation/payment";
import { DEFAULT_MODEL_ID, resolveModel } from "../lib/models";
import {
  BYOK_ENV,
  closeHarnesses,
  createHarness,
  type Harness,
  PGLITE_SETUP_TIMEOUT_MS,
  warmDatabase,
} from "./support/harness";

let h: Harness;
beforeAll(warmDatabase, PGLITE_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  h = await createHarness();
  await h.addUser("alice", 1);
});
afterEach(closeHarnesses);

const creditModel = () => {
  const model = resolveModel(DEFAULT_MODEL_ID);
  if (model) return model;
  throw new Error("no credit model");
};

// Another Generation takes the last credit between choosing and spending.
const raced = (calls: string[]) => async (payment: { source: string }) => {
  calls.push(payment.source);
  if (calls.length === 1) await spendCredit(h.db, "alice");
  await spendForReply(h.db, "alice", payment as never);
};

test("a lost race for the last credit moves payment to the BYOK key", async () => {
  await saveByokKey(h.db, BYOK_ENV, "alice", `sk-or-${"u".repeat(40)}`);
  const calls: string[] = [];
  const { payment } = await payForReply(
    h.ctx,
    "alice",
    creditModel(),
    raced(calls),
  );
  expect(calls).toEqual(["credits", "byok"]);
  expect(payment.source).toBe("byok");
  expect(await getCredits(h.db, "alice")).toBe(0);
});

test("a lost race with no BYOK key is no_credits", async () => {
  const calls: string[] = [];
  await expect(
    payForReply(h.ctx, "alice", creditModel(), raced(calls)),
  ).rejects.toMatchObject({ id: "no_credits", status: 402 });
  expect(calls).toEqual(["credits"]);
});
