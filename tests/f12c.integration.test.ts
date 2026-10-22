import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { ImageRequest } from "../lib/images/contract";
import { MemoryAttachmentStorage } from "./helpers/attachment-fixture";
import { betaFixture, privateKey } from "./helpers/beta-fixture";
import { imageEnv, png, snapshot } from "./helpers/image-fixture";
import { rejectionOf } from "./helpers/rejection";

mock.module("server-only", () => ({}));
const { ByokStore } = await import("../lib/byok/store");
const { ImageStore } = await import("../lib/images/store");
const { ImageService } = await import("../lib/images/service");
const { snapshotDigest } = await import("../lib/images/config");
const { imageHandlers } = await import("../lib/images/http");
const { canonicalPng } = await import("../lib/images/png");
const { AttachmentStore } = await import("../lib/attachments/store");
const { mutateArtifact, readArtifact } = await import(
  "../lib/artifacts/service"
);
const { exportOwnedAccount, deleteOwnedAccount } = await import(
  "../lib/actions/account/account"
);
const signal = () => new AbortController().signal;
async function fixture() {
  const f = await betaFixture();
  Object.assign(process.env, imageEnv);
  await f.db.$client
    .unsafe(
      "INSERT INTO chat(id,user_id,title) VALUES ('image-chat','alice','Images'),('bob-image','bob','Bob'); INSERT INTO chat_message(id,chat_id,user_id,role,parts,attachments) VALUES ('image-answer','image-chat','alice','assistant','[]','[]'),('image-user','image-chat','alice','user','[]','[]'),('bob-image-answer','bob-image','bob','assistant','[]','[]')",
    )
    .simple();
  const byok = new ByokStore(f.db);
  await byok.save("alice", "openrouter", privateKey, process.env, null);
  const revision = (await byok.credentials("alice"))[0].revision;
  const config = {
    storage: {
      url: "https://fixture.supabase.co",
      secretKey: "offline-storage-secret",
      bucket: "private",
    },
    platformBytes: 100 * 1024 * 1024,
    userBytes: 20 * 1024 * 1024,
    dailyTransferBytes: 100 * 1024 * 1024,
  };
  const storage = new MemoryAttachmentStorage(),
    store = new ImageStore(f.db);
  let calls = 0,
    color = 255,
    hook: () => Promise<void> = async () => {};
  const adapter = {
    generate: async (input: { key: string; signal: AbortSignal }) => {
      calls++;
      expect(input.key).toBe(privateKey);
      expect(input.signal.aborted).toBe(false);
      await hook();
      return canonicalPng(png(color), "image/png");
    },
  };
  const service = new ImageService(
    store,
    () => config,
    storage,
    adapter,
    process.env,
    byok,
  );
  const api = imageHandlers({
    access: (await import("../lib/auth/access")).requireChatAccess,
    service: () => service,
  });
  const body = (overrides: Partial<ImageRequest> = {}): ImageRequest => ({
    action: "generate",
    requestId: crypto.randomUUID(),
    chatId: "image-chat",
    messageId: "image-answer",
    title: "Offline image",
    prompt: "seeded-private-image-prompt",
    operation: "generate",
    funding: "byok:openrouter",
    modelId: snapshot.id,
    reviewDigest: snapshotDigest(snapshot),
    credentialRevision: revision,
    estimateMicrodollars: 120000,
    ceilingMicrodollars: 120000,
    providerBudgetAcknowledged: true,
    ...overrides,
  });
  const query = async (text: string, args: unknown[] = []) =>
    f.db.$client.unsafe(text, args as never[]);
  return {
    ...f,
    byok,
    store,
    config,
    storage,
    service,
    api,
    body,
    query,
    calls: () => calls,
    hook: (fn: () => Promise<void>) => {
      hook = fn;
    },
    color: (v: number) => {
      color = v;
    },
  };
}

describe("F12-C image lifecycle", () => {
  let current: Awaited<ReturnType<typeof fixture>>;
  beforeEach(
    async () => {
      current = await fixture();
    },
    { timeout: 15_000 },
  );

  test("F12-C owned immutable revisions, restore, explicit private downloads and account provenance", async () => {
    const f = current,
      input = f.body();
    const response = await f.api.POST(await f.request("/api/images", input));
    expect(response.status).toBe(200);
    const first = await response.json();
    expect(f.calls()).toBe(1);
    expect(f.storage.uploaded).toBe(1);
    const doc = await readArtifact("alice", first.id);
    expect(doc.kind).toBe("image");
    expect(JSON.parse(doc.content)).toMatchObject({
      prompt: input.prompt,
      model: snapshot,
      inputs: [],
      object: { width: 1024, height: 1024, mediaType: "image/png" },
    });
    const download = await f.api.object(
      await f.request(`/api/images/object?id=${first.id}&version=1`),
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(download.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    const original = new Uint8Array(await download.arrayBuffer());
    expect(
      (await f.api.object(await f.request(`/api/images/object?id=${first.id}`)))
        .status,
    ).toBe(404);
    expect(
      (
        await f.api.object(
          await f.request(
            `/api/images/object?id=${first.id}&version=1`,
            undefined,
            "bob",
          ),
        )
      ).status,
    ).toBe(404);
    f.color(127);
    await f.service.generate(
      "alice",
      f.body({ target: { id: first.id, expectedVersion: 1 } }),
      signal(),
    );
    await mutateArtifact("alice", {
      action: "restore",
      id: first.id,
      expectedVersion: 2,
      version: 1,
    });
    const restored = await readArtifact("alice", first.id);
    expect(restored.version).toBe(3);
    expect(restored.content).toBe(doc.content);
    expect((await f.query("SELECT * FROM image_object")).length).toBe(2);
    expect(
      (await f.service.download("alice", first.id, 1, signal())).bytes,
    ).toEqual(original);
    expect(
      (await f.service.download("alice", first.id, 3, signal())).bytes,
    ).toEqual(original);
    expect(
      await rejectionOf(
        mutateArtifact("alice", {
          action: "save",
          id: first.id,
          expectedVersion: 3,
          title: "Tamper",
          content: "{}",
        }),
      ),
    ).toMatchObject({ id: "invalid_artifact" });
    expect(
      await rejectionOf(
        f.service.generate(
          "alice",
          f.body({ target: { id: first.id, expectedVersion: 1 } }),
          signal(),
        ),
      ),
    ).toMatchObject({ id: "artifact_conflict" });
    expect(f.calls()).toBe(2);
    const exported = await exportOwnedAccount("alice");
    expect(exported.imageData.objects.length).toBe(2);
    expect(exported.imageData.generations.length).toBe(2);
    const serialized = JSON.stringify(exported.imageData);
    expect(serialized).toContain(input.prompt);
    expect(serialized).not.toContain(privateKey);
    expect(serialized).not.toContain("object_key");
    expect(serialized).not.toContain("signedURL");
    await mutateArtifact("alice", { action: "delete", id: first.id });
    expect((await f.query("SELECT * FROM image_object")).length).toBe(0);
    expect((await f.query("SELECT * FROM image_generation")).length).toBe(0);
    expect(
      (await f.query("SELECT * FROM attachment_delete_queue")).length,
    ).toBe(2);
  });
  test("F12-C denial boundaries precede any provider entry and failed capacity reservations roll back BYOK", async () => {
    const f = current;
    for (const override of [
      { estimateMicrodollars: 1 },
      { ceilingMicrodollars: 1 },
      { reviewDigest: "" },
      { reviewDigest: "a".repeat(63) },
      { reviewDigest: "a".repeat(65) },
      { reviewDigest: "A".repeat(64) },
      { reviewDigest: "g".repeat(64) },
      { reference: { id: crypto.randomUUID(), sha256: "a".repeat(64) } },
      { mask: { id: crypto.randomUUID(), sha256: "a".repeat(64) } },
      { messageId: "image-user" },
      { chatId: "temporary" },
      { chatId: "bob-image", messageId: "bob-image-answer" },
    ])
      expect(
        await rejectionOf(
          f.service.generate("alice", f.body(override), signal()),
        ),
      ).toBeInstanceOf(Error);
    const malformed = await f.request("/api/images", {
      ...f.body(),
      reviewDigest: "invalid-digest",
    });
    expect((await f.api.POST(malformed)).status).toBe(400);
    const req = await f.request("/api/images", f.body());
    req.headers.set("origin", "https://evil.invalid");
    expect((await f.api.POST(req)).status).toBe(403);
    expect(
      (await f.api.POST(await f.request("/api/images", f.body(), "outsider")))
        .status,
    ).toBe(403);
    expect(
      (await f.api.GET(new Request("https://galaxy.example/api/images")))
        .status,
    ).toBe(401);
    f.config.userBytes = 4 * 1024 * 1024 - 1;
    expect(
      await rejectionOf(f.service.generate("alice", f.body(), signal())),
    ).toMatchObject({ id: "attachment_storage_limit" });
    expect((await f.query("SELECT * FROM byok_operation")).length).toBe(0);
    expect(f.calls()).toBe(0);
    expect(f.storage.uploaded).toBe(0);
  });
  test("F12-C post-lock entry rejects changed review/expiry/capacity and releases pre-entry leases", async () => {
    const f = current;
    const request = f.body();
    await f.store.reserve("alice", request, snapshot, f.config, process.env);
    const dialect = new PgDialect();
    let changed = false;
    const originalTransaction = f.db.transaction.bind(f.db);
    const proxy = new Proxy(f.db, {
      get(target, property) {
        if (property !== "transaction") return Reflect.get(target, property);
        return (run: Parameters<typeof f.db.transaction>[0]) =>
          originalTransaction((tx) =>
            run(
              new Proxy(tx, {
                get(target, key) {
                  if (key !== "execute") return Reflect.get(target, key);
                  return async (
                    statement: Parameters<typeof tx.execute>[0],
                  ) => {
                    const value = await target.execute(statement);
                    if (
                      !changed &&
                      statement instanceof SQL &&
                      dialect.sqlToQuery(statement).sql.includes("41021410")
                    ) {
                      changed = true;
                      process.env.IMAGE_MODELS_JSON = JSON.stringify([
                        { ...snapshot, expiresAt: "2020-01-01T00:00:00Z" },
                      ]);
                    }
                    return value;
                  };
                },
              }),
            ),
          );
      },
    });
    const byok = new ByokStore(proxy),
      store = new ImageStore(proxy);
    expect(
      await rejectionOf(
        byok.enter(request.requestId, "alice", process.env, (tx) =>
          store.enter(
            tx,
            "alice",
            request.requestId,
            () => f.config,
            process.env,
          ),
        ),
      ),
    ).toMatchObject({ id: "images_unavailable" });
    expect(changed).toBe(true);
    await f.store.fail("alice", request.requestId, false);
    await f.byok.finish(
      request.requestId,
      "alice",
      "before_entry",
      process.env,
    );
    expect(
      (
        await f.query("SELECT state FROM byok_operation WHERE id=$1", [
          request.requestId,
        ])
      )[0].state,
    ).toBe("released");
    expect(f.calls()).toBe(0);
    process.env.IMAGE_MODELS_JSON = JSON.stringify([snapshot]);
    const next = f.body();
    await f.store.reserve("alice", next, snapshot, f.config, process.env);
    f.config.userBytes = 1;
    expect(
      await rejectionOf(
        f.byok.enter(next.requestId, "alice", process.env, (tx) =>
          f.store.enter(
            tx,
            "alice",
            next.requestId,
            () => f.config,
            process.env,
          ),
        ),
      ),
    ).toMatchObject({ id: "attachment_storage_limit" });
  });
  test("F12-C changed credential before entry denies decryption/dispatch and cancellation releases reserved work", async () => {
    const f = current,
      request = f.body();
    await f.store.reserve("alice", request, snapshot, f.config, process.env);
    await f.byok.delete("alice", "openrouter", request.credentialRevision);
    expect(
      await rejectionOf(
        f.byok.enter(request.requestId, "alice", process.env, (tx) =>
          f.store.enter(
            tx,
            "alice",
            request.requestId,
            () => f.config,
            process.env,
          ),
        ),
      ),
    ).toMatchObject({ id: "byok_key_missing" });
    expect((await f.service.cancel("alice", request.requestId)).state).toBe(
      "cancelled",
    );
    expect((await f.query("SELECT state FROM byok_operation"))[0].state).toBe(
      "released",
    );
    expect(f.calls()).toBe(0);
  });
  test("F12-C unknown provider outcome stays held, saves no revision, and anonymous hold survives account deletion", async () => {
    const f = current,
      request = f.body();
    f.hook(async () => {
      throw Error(`${privateKey} seeded-private-image-prompt base64-secret`);
    });
    const response = await f.api.POST(await f.request("/api/images", request));
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("image_held");
    expect((await f.service.status("alice", request.requestId)).state).toBe(
      "held",
    );
    expect((await f.query("SELECT * FROM artifact_revision")).length).toBe(0);
    expect((await f.query("SELECT state FROM byok_operation"))[0].state).toBe(
      "held",
    );
    expect(f.calls()).toBe(1);
    await deleteOwnedAccount("alice");
    expect((await f.query("SELECT * FROM image_generation")).length).toBe(0);
    expect((await f.query("SELECT state FROM byok_operation"))[0].state).toBe(
      "held",
    );
  });
  test("F12-C cancellation after provider entry discards late bytes and never retries", async () => {
    const f = current,
      request = f.body();
    f.hook(async () => {
      expect((await f.service.cancel("alice", request.requestId)).state).toBe(
        "held",
      );
    });
    expect(
      await rejectionOf(f.service.generate("alice", request, signal())),
    ).toMatchObject({ id: "image_held" });
    expect(f.calls()).toBe(1);
    expect(f.storage.uploaded).toBe(0);
    expect((await f.query("SELECT * FROM artifact_revision")).length).toBe(0);
    expect(
      await rejectionOf(f.service.generate("alice", request, signal())),
    ).toBeInstanceOf(Error);
    expect(f.calls()).toBe(1);
  });
  test("F12-C unknown uploads retain full liability and require terminal proof plus a repeated delete", async () => {
    const f = current,
      request = f.body();
    f.storage.unknownUpload = true;
    expect(
      await rejectionOf(f.service.generate("alice", request, signal())),
    ).toMatchObject({ id: "image_held" });
    const [tombstone] = await f.query("SELECT * FROM attachment_delete_queue");
    expect(tombstone.upload_state).toBe("entered");
    expect(tombstone.bytes).toBe(4 * 1024 * 1024);
    expect((await f.query("SELECT * FROM artifact_revision")).length).toBe(0);
    const attachments = new AttachmentStore(f.db);
    await f.query("UPDATE attachment_delete_queue SET not_before=now()");
    await f.storage.remove(tombstone.object_key);
    expect(
      await attachments.acknowledgeDelete(tombstone.object_key, "entered"),
    ).toBe(false);
    await f.store.uploadTerminal(tombstone.object_key);
    await f.storage.remove(tombstone.object_key);
    expect(
      await attachments.acknowledgeDelete(tombstone.object_key, "terminal"),
    ).toBe(true);
  });
  test("F12-C concurrent restored head wins CAS and late generated object is tombstoned", async () => {
    const f = current,
      first = await f.service.generate("alice", f.body(), signal());
    f.hook(async () => {
      await mutateArtifact("alice", {
        action: "restore",
        id: first.id,
        expectedVersion: 1,
        version: 1,
      });
    });
    expect(
      await rejectionOf(
        f.service.generate(
          "alice",
          f.body({ target: { id: first.id, expectedVersion: 1 } }),
          signal(),
        ),
      ),
    ).toMatchObject({ id: "image_held" });
    expect((await readArtifact("alice", first.id)).version).toBe(2);
    expect((await f.query("SELECT * FROM image_object")).length).toBe(1);
    expect(
      (await f.query("SELECT upload_state FROM attachment_delete_queue"))[0]
        .upload_state,
    ).toBe("terminal");
  });
  test("F12-C images and F10 attachments share processing, storage, tombstone, and transfer liability", async () => {
    const f = current,
      attachments = new AttachmentStore(f.db),
      request = f.body();
    await f.store.reserve("alice", request, snapshot, f.config, process.env);
    expect(
      await rejectionOf(
        attachments.reserve(
          "alice",
          "image-chat",
          { name: "x.txt", mediaType: "text/plain", kind: "text", bytes: 1 },
          f.config,
        ),
      ),
    ).toMatchObject({ id: "attachment_processing_limit" });
    await f.service.cancel("alice", request.requestId);
    const pending = await attachments.reserve(
      "alice",
      "image-chat",
      { name: "x.txt", mediaType: "text/plain", kind: "text", bytes: 1 },
      f.config,
    );
    expect(
      await rejectionOf(f.service.generate("alice", f.body(), signal())),
    ).toMatchObject({ id: "attachment_processing_limit" });
    await attachments.markDelete("alice", pending.id);
    f.config.userBytes = 4 * 1024 * 1024;
    expect(
      await rejectionOf(f.service.generate("alice", f.body(), signal())),
    ).toMatchObject({ id: "attachment_storage_limit" });
    f.config.userBytes = 8 * 1024 * 1024 + 1;
    f.config.dailyTransferBytes = 4 * 1024 * 1024;
    expect(
      await rejectionOf(f.service.generate("alice", f.body(), signal())),
    ).toMatchObject({ id: "attachment_transfer_limit" });
    expect(f.calls()).toBe(0);
    expect((await f.query("SELECT state FROM byok_operation"))[0].state).toBe(
      "released",
    );
  });
  test("F12-C reserved image slots count against ordinary artifacts and cancel releases the slot", async () => {
    const f = current,
      request = f.body();
    await f.query(
      'UPDATE chat_message SET parts=\'[{"type":"text","text":"Saved answer"}]\' WHERE id=\'image-answer\'',
    );
    await f.query(
      "BEGIN; INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) SELECT 'filled-'||i,'alice','image-chat','image-answer','markdown',1 FROM generate_series(1,49) i; INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) SELECT id,'alice',1,'Filled','x' FROM artifact; COMMIT;",
    );
    await f.store.reserve("alice", request, snapshot, f.config, process.env);
    const create = {
      action: "create",
      chatId: "image-chat",
      messageId: "image-answer",
      kind: "markdown",
      title: "Last slot",
    };
    expect(await rejectionOf(mutateArtifact("alice", create))).toMatchObject({
      id: "artifact_limit",
    });
    await f.service.cancel("alice", request.requestId);
    expect(await mutateArtifact("alice", create)).toHaveProperty("id");
    expect(
      (await f.query("SELECT count(*)::integer AS count FROM artifact"))[0]
        .count,
    ).toBe(50);
  });
  test("F12-C changed full review identity is denied after an awaited reservation lock", async () => {
    const f = current,
      request = f.body();
    await f.store.reserve("alice", request, snapshot, f.config, process.env);
    process.env.IMAGE_MODELS_JSON = JSON.stringify([
      { ...snapshot, provider: "different-endpoint" },
    ]);
    expect(
      await rejectionOf(
        f.byok.enter(request.requestId, "alice", process.env, (tx) =>
          f.store.enter(
            tx,
            "alice",
            request.requestId,
            () => f.config,
            process.env,
          ),
        ),
      ),
    ).toMatchObject({ id: "image_review_changed" });
    expect((await f.service.status("alice", request.requestId)).state).toBe(
      "reserved",
    );
    expect((await f.query("SELECT state FROM byok_operation"))[0].state).toBe(
      "reserved",
    );
    expect(f.calls()).toBe(0);
  });
  test("F12-C catalog review digest pins exact snapshot; mutations under same ID and estimate reject 409 before reservation", async () => {
    const f = current;
    const catalogA = await f.service.catalog("alice");
    expect(catalogA.available).toBe(true);
    expect(catalogA.reviewDigest).toBe(snapshotDigest(snapshot));
    if (!catalogA.reviewDigest)
      throw new Error("fixture_missing_catalog_digest");
    const digestA = catalogA.reviewDigest;

    const mutations: Array<{ name: string; mutated: typeof snapshot }> = [
      {
        name: "model",
        mutated: { ...snapshot, model: "fixture/mutated-model" },
      },
      {
        name: "provider",
        mutated: { ...snapshot, provider: "fixture/mutated-provider" },
      },
      {
        name: "review timestamp",
        mutated: { ...snapshot, reviewedAt: "2026-01-02T00:00:00Z" },
      },
      {
        name: "expiry",
        mutated: { ...snapshot, expiresAt: "2029-01-01T00:00:00Z" },
      },
      {
        name: "provider maximum",
        mutated: {
          ...snapshot,
          providerMaxMicrodollarsPerImage: 110_000,
        },
      },
    ];

    for (const { mutated } of mutations) {
      expect(mutated.id).toBe(snapshot.id);
      expect(mutated.worstCaseEstimateMicrodollars).toBe(
        snapshot.worstCaseEstimateMicrodollars,
      );
      process.env.IMAGE_MODELS_JSON = JSON.stringify([mutated]);

      const staleRequest = f.body({ reviewDigest: digestA });
      const response = await f.api.POST(
        await f.request("/api/images", staleRequest),
      );
      expect(response.status).toBe(409);
      const data = await response.json();
      expect(data.error?.id).toBe("image_review_changed");

      expect(f.calls()).toBe(0);
      expect((await f.query("SELECT * FROM image_generation")).length).toBe(0);
      expect((await f.query("SELECT * FROM image_object")).length).toBe(0);
      expect((await f.query("SELECT * FROM byok_operation")).length).toBe(0);
    }

    process.env.IMAGE_MODELS_JSON = JSON.stringify([snapshot]);

    const freshCatalog = await f.service.catalog("alice");
    expect(freshCatalog.reviewDigest).toBe(digestA);
    if (!freshCatalog.reviewDigest)
      throw new Error("fixture_missing_catalog_digest");
    const validRequest = f.body({ reviewDigest: freshCatalog.reviewDigest });
    const successResponse = await f.api.POST(
      await f.request("/api/images", validRequest),
    );
    expect(successResponse.status).toBe(200);
    const created = await successResponse.json();
    expect(created.id).toBeDefined();
    expect(f.calls()).toBe(1);
    expect((await f.query("SELECT * FROM image_generation")).length).toBe(1);
    expect((await f.query("SELECT * FROM image_object")).length).toBe(1);
  });
  test("F12-C downloads reject corruption and reserve transfer before reading bytes", async () => {
    const f = current,
      first = await f.service.generate("alice", f.body(), signal());
    const [row] = await f.query("SELECT * FROM image_object");
    const bytes = f.storage.objects.get(row.object_key);
    if (!bytes) throw Error("fixture_image_missing");
    const corrupt = bytes.slice();
    corrupt[40] ^= 1;
    f.storage.objects.set(row.object_key, corrupt);
    expect(
      await rejectionOf(f.service.download("alice", first.id, 1, signal())),
    ).toMatchObject({ id: "image_integrity_failed" });
    f.config.dailyTransferBytes = 1;
    const reads = f.storage.downloaded;
    expect(
      await rejectionOf(f.service.download("alice", first.id, 1, signal())),
    ).toMatchObject({ id: "attachment_transfer_limit" });
    expect(f.storage.downloaded).toBe(reads);
  });
  test("F12-C expired leases release only pre-entry work and hold entered provider work", async () => {
    const f = current,
      request = f.body();
    await f.store.reserve("alice", request, snapshot, f.config, process.env);
    await f.query(
      "UPDATE image_object SET lease_until=now()-interval '1 minute'",
    );
    await f.store.recover();
    expect((await f.service.status("alice", request.requestId)).state).toBe(
      "failed",
    );
    expect(
      (
        await f.query("SELECT state FROM byok_operation WHERE id=$1", [
          request.requestId,
        ])
      )[0].state,
    ).toBe("released");
    const entered = f.body();
    await f.store.reserve("alice", entered, snapshot, f.config, process.env);
    await f.byok.enter(entered.requestId, "alice", process.env, (tx) =>
      f.store.enter(
        tx,
        "alice",
        entered.requestId,
        () => f.config,
        process.env,
      ),
    );
    await f.query(
      "UPDATE image_object SET lease_until=now()-interval '1 minute'",
    );
    await f.store.recover();
    expect((await f.service.status("alice", entered.requestId)).state).toBe(
      "held",
    );
    expect(
      (
        await f.query("SELECT state FROM byok_operation WHERE id=$1", [
          entered.requestId,
        ])
      )[0].state,
    ).toBe("held");
    expect((await f.query("SELECT * FROM image_object")).length).toBe(0);
  });
  test("F12-C credential revocation and message deletion discard entered output without a revision", async () => {
    const f = current,
      request = f.body();
    f.hook(async () => {
      await f.byok.delete("alice", "openrouter", request.credentialRevision);
    });
    expect(
      await rejectionOf(f.service.generate("alice", request, signal())),
    ).toMatchObject({ id: "image_held" });
    expect((await f.query("SELECT * FROM artifact_revision")).length).toBe(0);
    expect(
      (await f.query("SELECT * FROM attachment_delete_queue")).length,
    ).toBe(1);
    await f.byok.save("alice", "openrouter", privateKey, process.env, null);
    const revision = (await f.byok.credentials("alice"))[0].revision;
    const next = f.body({ credentialRevision: revision });
    // The first unknown operation intentionally consumes concurrency. Operator evidence
    // is simulated only inside this offline fixture to exercise the next independent race.
    await f.query("UPDATE byok_operation SET state='complete'");
    f.hook(async () => {
      await (await import("../lib/actions/chat/chat-message")).deleteMessage(
        "image-answer",
        "alice",
      );
    });
    expect(
      await rejectionOf(f.service.generate("alice", next, signal())),
    ).toMatchObject({ id: "image_held" });
    expect((await f.query("SELECT * FROM image_generation")).length).toBe(0);
    expect(
      (
        await f.query("SELECT state FROM byok_operation WHERE id=$1", [
          next.requestId,
        ])
      )[0].state,
    ).toBe("held");
    expect((await f.query("SELECT * FROM artifact_revision")).length).toBe(0);
  });
  test("F12-C cancellation aborts before entry, redacts provider errors, and never creates a revision", async () => {
    const f = current,
      aborted = new AbortController();
    aborted.abort();
    await expect(
      f.service.generate("alice", f.body(), aborted.signal),
    ).rejects.toThrow();
    expect(f.calls()).toBe(0);
    let logged = "";
    const log = spyOn(process.stderr, "write").mockImplementation((chunk) => {
      logged += String(chunk);
      return true;
    });
    try {
      f.hook(async () => {
        throw Error(
          `${privateKey} seeded-private-image-prompt base64-secret https://fixture.supabase.co/private`,
        );
      });
      const response = await f.api.POST(
        await f.request("/api/images", f.body()),
      );
      const serialized = await response.text();
      for (const secret of [
        privateKey,
        "seeded-private-image-prompt",
        "base64-secret",
        "https://fixture.supabase.co/private",
      ])
        expect(logged + serialized).not.toContain(secret);
      expect(serialized).toContain("image_held");
      expect((await f.query("SELECT * FROM artifact_revision")).length).toBe(0);
    } finally {
      log.mockRestore();
    }
  });
});

describe("F12-C migration runner", () => {
  let db: PGlite;
  beforeAll(
    async () => {
      db = await PGlite.create();
      await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    },
    { timeout: 15_000 },
  );
  afterAll(
    async () => {
      await db?.close();
    },
    { timeout: 15_000 },
  );
  test("F12-C populated 0010 upgrade works with absent intermediate numbers, preserves history and enables private image schema", async () => {
    const { applyVersionedMigrations } = await import("../lib/db/migrate");
    const files = readdirSync("drizzle")
      .filter((n) => n.endsWith(".sql"))
      .sort();
    const executor = {
      transaction: async (
        run: Parameters<
          typeof applyVersionedMigrations
        >[0]["transaction"] extends (run: infer R) => unknown
          ? R
          : never,
      ) =>
        db.transaction(async (tx) =>
          run({
            lock: async () => {
              await tx.query("SELECT pg_advisory_xact_lock(41021401)");
            },
            ensureMigrationsTable: async () => {
              await tx.exec(
                "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY)",
              );
            },
            appliedVersions: async () =>
              (
                await tx.query<{ version: string }>(
                  "SELECT version FROM schema_migrations",
                )
              ).rows.map((row) => row.version),
            applySql: async (text: string) => {
              await tx.exec(text);
            },
            recordVersion: async (version: string) => {
              await tx.query(
                "INSERT INTO schema_migrations(version) VALUES($1)",
                [version],
              );
            },
          }),
        ),
    };
    const migrations = files.map((file) => ({
      version: file.replace(/\.sql$/, ""),
      sql: readFileSync(`drizzle/${file}`, "utf8"),
    }));
    await applyVersionedMigrations(
      executor,
      migrations.filter((m) => m.version < "0011"),
    );
    await db.exec(
      "INSERT INTO \"user\"(id,name,email) VALUES ('owner','Owner','owner@example.invalid');INSERT INTO chat(id,user_id,title) VALUES ('origin','owner','Origin');INSERT INTO chat_message(id,chat_id,user_id,role,parts,attachments) VALUES ('answer','origin','owner','assistant','[]','[]');BEGIN;INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES ('kept','owner','origin','answer','table',1);INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) VALUES ('kept','owner',1,'Kept','{}');COMMIT;",
    );
    await applyVersionedMigrations(executor, migrations);
    await applyVersionedMigrations(executor, migrations);
    expect(
      (
        await db.query<{ version: string }>(
          "SELECT version FROM schema_migrations ORDER BY version",
        )
      ).rows.map((r) => r.version),
    ).toEqual(migrations.map((m) => m.version));
    expect(
      (
        await db.query(
          "SELECT content FROM artifact_revision WHERE artifact_id='kept'",
        )
      ).rows,
    ).toEqual([{ content: "{}" }]);
    expect(
      (
        await db.query(
          "SELECT relrowsecurity FROM pg_class WHERE relname IN ('image_object','image_generation')",
        )
      ).rows,
    ).toEqual([{ relrowsecurity: true }, { relrowsecurity: true }]);
    expect(
      (await db.query("SELECT count(*)::integer AS count FROM image_object"))
        .rows,
    ).toEqual([{ count: 0 }]);
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "SELECT has_table_privilege('anon','image_object','SELECT') OR has_table_privilege('authenticated','image_generation','INSERT') AS allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
  });
});
