import { sql } from "drizzle-orm";
import { attachmentConfigFixture } from "./attachment-fixture";
import { betaFixture } from "./beta-fixture";
export async function attachmentHttpFixture(options?: {
  skipPlanRegistration?: boolean;
}) {
  const f = await betaFixture({
    skipPlanRegistration: options?.skipPlanRegistration,
    environment: {
      SUPABASE_URL: attachmentConfigFixture.storage.url,
      SUPABASE_SECRET_KEY: attachmentConfigFixture.storage.secretKey,
      SUPABASE_STORAGE_BUCKET: "private",
      ATTACHMENTS_ENABLED: "1",
      ATTACHMENT_PLATFORM_BYTES: "1048576",
      ATTACHMENT_USER_BYTES: "524288",
      ATTACHMENT_DAILY_TRANSFER_BYTES: "10485760",
    },
  });
  f.cost(0);
  const provider = globalThis.fetch;
  const objects = new Map<string, Uint8Array>();
  let reads = 0;
  let onRead: () => Promise<void> = async () => {};
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname !== "fixture.supabase.co") return provider(input, init);
      if (url.pathname === "/storage/v1/bucket/private")
        return Response.json({ id: "private", public: false });
      const prefix = "/storage/v1/object/";
      if (url.pathname.startsWith(`${prefix}sign/private/`)) {
        const key = url.pathname.slice(`${prefix}sign/private/`.length);
        if (init?.method === "POST")
          return Response.json({
            signedURL: `/object/sign/private/${key}?token=fixture`,
          });
        await onRead();
        reads++;
        const bytes = objects.get(key);
        return bytes
          ? new Response(new Uint8Array(bytes).buffer)
          : new Response(null, { status: 404 });
      }
      if (
        url.pathname === "/storage/v1/object/private" &&
        init?.method === "DELETE"
      ) {
        for (const key of JSON.parse(String(init.body)).prefixes)
          objects.delete(key);
        return Response.json([]);
      }
      if (
        url.pathname.startsWith(`${prefix}private/`) &&
        init?.method === "POST"
      ) {
        const key = url.pathname.slice(`${prefix}private/`.length);
        if (objects.has(key)) return new Response(null, { status: 409 });
        objects.set(key, new Uint8Array(init.body as ArrayBuffer));
        return Response.json({ Key: key });
      }
      throw new Error("unexpected_fixture_storage_request");
    },
    { preconnect: provider.preconnect },
  );
  const chatId = crypto.randomUUID();
  const bobChatId = crypto.randomUUID();
  for (const [id, owner] of [
    [chatId, "alice"],
    [bobChatId, "bob"],
  ]) {
    await f.db.execute(
      sql`INSERT INTO chat(id,user_id,title) VALUES(${id},${owner},'File conversation')`,
    );
    await f.db.execute(
      sql`INSERT INTO chat_branch(id,chat_id,user_id,label,messages) VALUES(${id},${id},${owner},'Original','[]')`,
    );
  }
  return {
    ...f,
    chatId,
    bobChatId,
    objects,
    reads: () => reads,
    onRead: (callback: () => Promise<void>) => {
      onRead = callback;
    },
  };
}
