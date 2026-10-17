import { expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describeFile } from "../lib/attachments/content";
import * as schema from "../lib/db/schema";
import { attachmentConfigFixture } from "./helpers/attachment-fixture";
import { rejectionOf } from "./helpers/rejection";

mock.module("server-only", () => ({}));
const { AttachmentStore } = await import("../lib/attachments/store");
const { closeDb, requireDb } = await import("../lib/db/client");
const { deleteOwnedAccount, exportOwnedAccount } = await import(
  "../lib/actions/account/account"
);
const { deleteChat } = await import("../lib/actions/chat/chat");
const nativeURL = process.env.F10_F11_POSTGRES_URL;
const nativeTest = nativeURL ? test : test.skip;
function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function blocked(
  observer: ReturnType<typeof postgres>,
  waiter: number,
  holder: number,
) {
  for (let i = 0; i < 200; i++) {
    const rows = await observer<
      { blocked: boolean }[]
    >`SELECT ${holder}=ANY(pg_blocking_pids(${waiter})) AS blocked`;
    if (rows[0].blocked) return;
    await setTimeout(5);
  }
  throw new Error("native_fixture_expected_lock_wait_not_observed");
}
/** Native PG only: PGlite's single backend cannot establish row-lock concurrency.
 * This test creates/drops its own random database on an explicitly opted-in local
 * server. Two transaction sessions plus an observer reproduce the FK inversion;
 * parent deletion uses the real application queue as a third transaction.
 */
nativeTest(
  "F10/F11 native concurrent artifact FK and attachment reservation complete, retain quotas, and serialize parent deletion",
  async () => {
    if (!nativeURL) throw new Error("native_fixture_url_required");
    const parsed = new URL(nativeURL);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
      throw new Error("native_fixture_must_be_local");
    const admin = postgres(nativeURL, {
      max: 1,
      prepare: false,
      onnotice: () => {},
    });
    const name = `galaxy_f10_f11_${crypto.randomUUID().replaceAll("-", "")}`;
    const previous = { ...process.env };
    const clients: ReturnType<typeof postgres>[] = [];
    let created = false;
    try {
      await closeDb();
      await admin.unsafe(`CREATE DATABASE ${name}`);
      created = true;
      parsed.pathname = `/${name}`;
      const connect = () => {
        const client = postgres(parsed.toString(), {
          max: 1,
          prepare: false,
          onnotice: () => {},
          connection: { statement_timeout: 4000, lock_timeout: 3000 },
        });
        clients.push(client);
        return client;
      };
      const owner = connect(),
        writer = connect(),
        observer = connect();
      for (const file of readdirSync("drizzle")
        .filter((f) => f.endsWith(".sql"))
        .sort())
        await observer.unsafe(readFileSync(`drizzle/${file}`, "utf8")).simple();
      process.env.DATABASE_URL = parsed.toString();
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SECRET_KEY;
      delete process.env.SUPABASE_STORAGE_BUCKET;
      const app = requireDb();
      const appPid = Number(
        (await app.$client`SELECT pg_backend_pid() AS pid`)[0].pid,
      );
      const ownerPid = Number(
        (await owner`SELECT pg_backend_pid() AS pid`)[0].pid,
      );
      const writerPid = Number(
        (await writer`SELECT pg_backend_pid() AS pid`)[0].pid,
      );
      expect(new Set([ownerPid, writerPid, appPid]).size).toBe(3);
      const store = new AttachmentStore(drizzle(writer, { schema }));
      const config = {
        ...attachmentConfigFixture,
        platformBytes: 64,
        userBytes: 4,
      };
      await observer`INSERT INTO "user"(id,name,email) VALUES ('other','Other','other@example.invalid')`;
      await observer`INSERT INTO chat(id,user_id,title) VALUES ('other-chat','other','Other')`;
      for (const deletion of ["none", "chat", "account"] as const) {
        const userId = `owner-${deletion}`,
          chatId = `chat-${deletion}`,
          messageId = `message-${deletion}`;
        const artifactId = crypto.randomUUID();
        await observer`INSERT INTO "user"(id,name,email) VALUES (${userId},'Owner',${`${userId}@example.invalid`})`;
        await observer`INSERT INTO chat(id,user_id,title) VALUES (${chatId},${userId},'Owned')`;
        await observer`INSERT INTO chat_message(id,chat_id,user_id,role,parts,attachments) VALUES (${messageId},${chatId},${userId},'assistant','[{"type":"text","text":"Evidence"}]','[]')`;
        const locked = gate(),
          proceed = gate();
        const ownerRun = owner.begin(async (tx) => {
          await tx`SET LOCAL deadlock_timeout='100ms'`;
          // Same owner-first lock and actual FK writes as artifact creation. The
          // gate isolates this engine-level lock contract; route tests cover CRUD.
          await tx`SELECT id FROM "user" WHERE id=${userId} FOR UPDATE`;
          locked.release();
          await proceed.promise;
          await tx`INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES (${artifactId},${userId},${chatId},${messageId},'markdown',1)`;
          await tx`INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) VALUES (${artifactId},${userId},1,'Evidence','Evidence')`;
        });
        // Observe every rejection immediately, including the intentional old-code
        // deadlock reproduction, rather than leaving an unhandled remote promise.
        const ownerDone = Promise.resolve(ownerRun).then(
          () => null,
          (error) => error,
        );
        let reserveDone:
          | Promise<Awaited<ReturnType<typeof store.reserve>> | Error>
          | undefined;
        let deleteDone: Promise<unknown> | undefined;
        try {
          await locked.promise;
          reserveDone = store
            .reserve(
              userId,
              chatId,
              describeFile("a.txt", "text/plain", 4),
              config,
            )
            .catch((error) => error);
          await blocked(observer, writerPid, ownerPid);
          if (deletion !== "none") {
            deleteDone = (
              deletion === "chat"
                ? deleteChat(chatId, userId)
                : deleteOwnedAccount(userId)
            ).catch((error) => error);
            // Real deletion must wait on attachment capacity's advisory lock before
            // touching owner/parent rows; the reservation's parent pin remains safe.
            await blocked(observer, appPid, writerPid);
          }
          proceed.release();
          expect(await ownerDone).toBeNull();
          const reserved = await reserveDone;
          if (reserved instanceof Error) throw reserved;
          expect(reserved.user_id).toBe(userId);
          if (deletion === "none") {
            expect(
              await observer`SELECT id FROM artifact WHERE id=${artifactId}`,
            ).toHaveLength(1);
            const exported = await exportOwnedAccount(userId);
            expect(exported.artifacts.map((a) => a.id)).toEqual([artifactId]);
            expect(exported.attachments.map((a) => a.id)).toEqual([
              reserved.id,
            ]);
            expect(JSON.stringify(exported.attachments)).not.toContain(
              "object_key",
            );
            expect(
              await rejectionOf(
                store.reserve(
                  userId,
                  chatId,
                  describeFile("b.txt", "text/plain", 1),
                  config,
                ),
              ),
            ).toMatchObject({ id: "attachment_storage_limit" });
            expect(
              await rejectionOf(
                store.reserve(
                  "other",
                  chatId,
                  describeFile("b.txt", "text/plain", 1),
                  config,
                ),
              ),
            ).toMatchObject({ id: "not_found" });
            await deleteChat(chatId, userId);
          } else {
            const deleted = await deleteDone;
            expect(deleted).not.toBeInstanceOf(Error);
            expect(
              await observer`SELECT id FROM attachment WHERE user_id=${userId}`,
            ).toHaveLength(0);
            expect(
              await observer`SELECT id FROM artifact WHERE user_id=${userId}`,
            ).toHaveLength(0);
            expect(
              await observer`SELECT artifact_id FROM artifact_revision WHERE user_id=${userId}`,
            ).toHaveLength(0);
            expect(
              await observer`SELECT id FROM chat WHERE id=${chatId}`,
            ).toHaveLength(0);
            const jobs =
              await observer`SELECT bytes,upload_state FROM attachment_delete_queue WHERE object_key=${reserved.object_key}`;
            expect([...jobs]).toEqual([{ bytes: 4, upload_state: "reserved" }]);
          }
        } finally {
          proceed.release();
          await ownerDone;
          await reserveDone;
          await deleteDone;
        }
      }
      expect(
        await observer`SELECT id FROM "user" WHERE id='other'`,
      ).toHaveLength(1);
      expect(
        await observer`SELECT id FROM chat WHERE id='other-chat'`,
      ).toHaveLength(1);
    } finally {
      await closeDb();
      for (const client of clients) await client.end({ timeout: 1 });
      if (created) await admin.unsafe(`DROP DATABASE ${name}`);
      await admin.end({ timeout: 1 });
      for (const key of Object.keys(process.env))
        if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  },
);
