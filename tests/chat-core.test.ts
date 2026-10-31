import { expect, test } from "bun:test";
import { settleParts } from "../lib/chat/store";
import { latestLeaf, pathTo, versionsOf } from "../lib/chat/tree";
import {
  acquireGeneration,
  getActiveGeneration,
  isStopRequested,
  releaseGeneration,
  renewGeneration,
  requestStop,
} from "../lib/generation/locks";
import { cleanTitle } from "../lib/generation/title";
import {
  DEFAULT_MODEL_ID,
  findModel,
  MODELS,
  resolveModel,
  titleModel,
} from "../lib/models";
import { RATE_LIMITS, redisRateLimit } from "../lib/ratelimit";
import { MemoryRedis } from "./support/memory-redis";

const at = (id: string, parentId: string | null, ms: number) => ({
  id,
  parentId,
  createdAt: new Date(ms),
});

test("tree: path, Versions and the newest leaf below a Version", () => {
  const messages = [
    at("u1", null, 1),
    at("a1", "u1", 2),
    at("u2", "a1", 3),
    at("a2", "u2", 4),
    at("a2b", "u2", 5),
    at("u1b", null, 6),
    at("a1b", "u1b", 7),
  ];
  expect(pathTo(messages, "a2b").map((m) => m.id)).toEqual([
    "u1",
    "a1",
    "u2",
    "a2b",
  ]);
  expect(pathTo(messages, null)).toEqual([]);
  expect(pathTo(messages, "missing")).toEqual([]);
  expect(versionsOf(messages, at("a2", "u2", 4))).toEqual({
    ids: ["a2", "a2b"],
    index: 0,
  });
  expect(versionsOf(messages, at("u1b", null, 6))).toEqual({
    ids: ["u1", "u1b"],
    index: 1,
  });
  expect(latestLeaf(messages, "u1")).toBe("a2b");
  expect(latestLeaf(messages, "u1b")).toBe("a1b");
  expect(latestLeaf(messages, "a2")).toBe("a2");
});

test("stored parts never stay streaming", () => {
  expect(
    settleParts([
      { type: "step-start" },
      { type: "text", text: "hi", state: "streaming" },
      { type: "reasoning", text: "r", state: "done" },
    ]),
  ).toEqual([
    { type: "step-start" },
    { type: "text", text: "hi", state: "done" },
    { type: "reasoning", text: "r", state: "done" },
  ]);
});

test("models: decided Credit models, a default, and BYOK custom IDs", () => {
  expect(
    MODELS.filter((model) => model.creditModel).map((model) => model.id),
  ).toEqual([
    "openai/gpt-6-luna",
    "anthropic/claude-haiku-5.5",
    "google/gemini-2.5-flash-lite",
  ]);
  expect(MODELS.length).toBeGreaterThanOrEqual(10);
  expect(MODELS.length).toBeLessThanOrEqual(15);
  expect(new Set(MODELS.map((model) => model.id)).size).toBe(MODELS.length);
  expect(findModel(DEFAULT_MODEL_ID)?.creditModel).toBe(true);
  expect(titleModel().id).toBe("google/gemini-2.5-flash-lite");

  expect(resolveModel("anthropic/claude-sonnet-5.5")?.creditModel).toBe(false);
  expect(resolveModel("some-lab/model-x:free")).toEqual({
    id: "some-lab/model-x:free",
    creditModel: false,
    catalog: null,
  });
  for (const invalid of [
    "",
    "no-slash",
    "a/b c",
    "../etc",
    `a/${"x".repeat(100)}`,
  ]) {
    expect(resolveModel(invalid)).toBeNull();
  }
});

test("titles are cleaned and shortened", () => {
  expect(cleanTitle(' "Planning a  trip to Rome." ')).toBe(
    "Planning a trip to Rome",
  );
  expect(cleanTitle("   ")).toBeNull();
  expect(cleanTitle("x".repeat(200))?.length).toBe(80);
});

const active = (generationId: string) => ({
  generationId,
  messageId: `reply-${generationId}`,
});

test("locks: per Chat, three per User, compare-and-delete, expiry", async () => {
  const kv = new MemoryRedis();
  const ttl = 1_000;
  const first = await acquireGeneration(
    kv,
    { chatId: "c1", userId: "u", active: active("g1") },
    ttl,
  );
  if (!first.ok) throw new Error("expected a lease");
  expect(await getActiveGeneration(kv, "c1")).toEqual(active("g1"));
  expect(
    await acquireGeneration(
      kv,
      { chatId: "c1", userId: "u", active: active("g2") },
      ttl,
    ),
  ).toEqual({ ok: false, error: "generation_in_progress" });

  for (const chatId of ["c2", "c3"]) {
    const lease = await acquireGeneration(
      kv,
      { chatId, userId: "u", active: active(chatId) },
      ttl,
    );
    expect(lease.ok).toBe(true);
  }
  expect(
    await acquireGeneration(
      kv,
      { chatId: "c4", userId: "u", active: active("g4") },
      ttl,
    ),
  ).toEqual({ ok: false, error: "too_many_generations" });
  // The refused attempt did not keep the Chat lock.
  expect(await getActiveGeneration(kv, "c4")).toBeNull();

  // Renewal keeps a live Generation's locks past the original expiry.
  kv.advance(800);
  expect(await renewGeneration(kv, first.lease, ttl)).toBe(true);
  kv.advance(800);
  expect(await getActiveGeneration(kv, "c1")).toEqual(active("g1"));

  // c2 and c3 crashed: their locks expire and free the User's slots.
  kv.advance(300);
  expect(await getActiveGeneration(kv, "c2")).toBeNull();
  const after = await acquireGeneration(
    kv,
    { chatId: "c4", userId: "u", active: active("g4") },
    ttl,
  );
  expect(after.ok).toBe(true);

  // An expired lease cannot renew or release a lock someone else now holds.
  kv.advance(2_000);
  const next = await acquireGeneration(
    kv,
    { chatId: "c1", userId: "u", active: active("g5") },
    ttl,
  );
  expect(next.ok).toBe(true);
  expect(await renewGeneration(kv, first.lease, ttl)).toBe(false);
  await releaseGeneration(kv, first.lease);
  expect(await getActiveGeneration(kv, "c1")).toEqual(active("g5"));
});

test("Stop is a durable flag per Generation", async () => {
  const kv = new MemoryRedis();
  expect(await isStopRequested(kv, "g1")).toBe(false);
  await requestStop(kv, "g1");
  expect(await isStopRequested(kv, "g1")).toBe(true);
  expect(await isStopRequested(kv, "g2")).toBe(false);
});

test("rate limits count per User and kind in fixed windows", async () => {
  const kv = new MemoryRedis();
  const limit = redisRateLimit(kv, () => kv.now());
  const { limit: max, windowMs } = RATE_LIMITS.send;
  kv.advance(windowMs - (kv.now() % windowMs));
  for (let i = 0; i < max; i++) expect(await limit("send", "u")).toBe(true);
  expect(await limit("send", "u")).toBe(false);
  expect(await limit("send", "other")).toBe(true);
  expect(await limit("byok", "u")).toBe(true);
  kv.advance(windowMs);
  expect(await limit("send", "u")).toBe(true);
});
