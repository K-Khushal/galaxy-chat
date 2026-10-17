import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { makeSignature } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { rejectionOf } from "./helpers/rejection";

mock.module("server-only", () => ({}));

let currentHeaders = new Headers();
mock.module("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      delete: () => undefined,
      get: () => undefined,
      set: () => undefined,
    }),
  headers: () => Promise.resolve(currentHeaders),
}));

const secret = "f03-local-test-secret-value-32ch";
const tiedAt = new Date("2026-03-01T12:00:00.000Z");

type HistoryGet = (request: NextRequest) => Promise<Response>;
type MessageRoutes = {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
};
type ChatRoutes = {
  DELETE: (request: Request) => Promise<Response>;
  PATCH: (request: Request) => Promise<Response>;
};
type AccountRoutes = {
  DELETE: (request: Request) => Promise<Response>;
  GET: (request: Request) => Promise<Response>;
};
type UploadRoutes = {
  DELETE: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
};
type AuthRoutes = {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
};

let database: PGlite | null = null;
let socket: PGLiteSocketServer | null = null;
let closeDb: (() => Promise<void>) | null = null;
let resetAuthCache: (() => void) | null = null;
let db: NonNullable<ReturnType<typeof import("../lib/db/client").getDb>>;
let historyGet: HistoryGet;
let messages: MessageRoutes;
let chatRoutes: ChatRoutes;
let accountRoutes: AccountRoutes;
let exportGet: (request: Request) => Promise<Response>;
let uploadRoutes: UploadRoutes;
let libraryGet: (request: Request) => Promise<Response>;
let authRoutes: AuthRoutes;
let deleteChatMessages: (id: string) => Promise<void>;
let getAuth: typeof import("../lib/auth/server").getAuth;
let sessionTable: typeof import("../lib/db/schema").session;
let userTable: typeof import("../lib/db/schema").user;
let chatTable: typeof import("../lib/db/schema").chat;
let messageTable: typeof import("../lib/db/schema").chatMessage;

beforeAll(async () => {
  database = await PGlite.create();
  socket = new PGLiteSocketServer({
    db: database,
    host: "127.0.0.1",
    maxConnections: 4,
    port: 0,
  });
  await socket.start();
  const url = `postgres://postgres:postgres@${socket.getServerConn()}/postgres`;
  process.env.DATABASE_URL = url;
  process.env.BETTER_AUTH_SECRET = secret;
  process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";
  process.env.GITHUB_CLIENT_ID = "local-github-client";
  process.env.GITHUB_CLIENT_SECRET = "local-github-secret";
  process.env.GITHUB_INVITE_LOGINS = "alice,bob,deleter,survivor";
  process.env.FUNDED_INFERENCE = "0";
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_SECRET_KEY = "";
  process.env.SUPABASE_STORAGE_BUCKET = "";

  const migrated = Bun.spawn(["bun", "scripts/db-migrate.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    migrated.exited,
    new Response(migrated.stdout).text(),
    new Response(migrated.stderr).text(),
  ]);
  expect(code).toBe(0);
  expect(stdout).toContain("migrations applied");
  expect(stderr).toBe("");

  const client = await import("../lib/db/client");
  const schema = await import("../lib/db/schema");
  const auth = await import("../lib/auth/server");
  const history = await import("../app/(chat)/api/history/route");
  const messageRoute = await import("../app/(chat)/api/messages/route");
  const chatRoute = await import("../app/(chat)/api/chat/route");
  const accountRoute = await import("../app/(chat)/api/account/route");
  const exportRoute = await import("../app/(chat)/api/account/export/route");
  const uploadRoute = await import("../app/(chat)/api/upload/route");
  const libraryRoute = await import("../app/(chat)/api/library/route");
  const authRoute = await import("../app/api/auth/[...all]/route");
  const action = await import("../app/(chat)/action");

  closeDb = client.closeDb;
  resetAuthCache = auth.resetAuthCache;
  const connected = client.getDb();
  if (!connected) {
    throw new Error("test database did not connect");
  }
  db = connected;
  historyGet = history.GET;
  messages = messageRoute;
  chatRoutes = chatRoute;
  accountRoutes = accountRoute;
  exportGet = exportRoute.GET;
  uploadRoutes = uploadRoute;
  libraryGet = libraryRoute.GET;
  authRoutes = authRoute;
  deleteChatMessages = action.deleteChatMessages;
  getAuth = auth.getAuth;
  sessionTable = schema.session;
  userTable = schema.user;
  chatTable = schema.chat;
  messageTable = schema.chatMessage;

  const versions = await db
    .select({ version: schema.schemaMigrations.version })
    .from(schema.schemaMigrations);
  expect(versions.map((row) => row.version).sort()).toEqual([
    "0000_baseline",
    "0001_ownership",
    "0002_credit_ledger",
    "0003_chat_branches",
    "0004_byok",
    "0005_explicit_context",
  ]);

  await db
    .insert(schema.user)
    .values([
      userRow("user-alice", "Alice", "alice@example.com", "alice"),
      userRow("user-bob", "Bob", "bob@example.com", "bob"),
      userRow("user-carol", "Carol", "carol@example.com", "carol"),
      userRow("user-deleter", "Deleter", "deleter@example.com", "deleter"),
      userRow("user-survivor", "Survivor", "survivor@example.com", "survivor"),
    ]);
  await insertSession("user-alice", "alice-token");
  await insertSession("user-bob", "bob-token");
  await insertSession("user-deleter", "deleter-token");
  await insertSession("user-survivor", "survivor-token");
  await db
    .insert(schema.chat)
    .values([
      chatRow("z3", "user-alice", "alphz3"),
      chatRow("z2", "user-alice", "alphz2"),
      chatRow("z1", "user-alice", "alphz1"),
      chatRow("z0", "user-alice", "100%_done"),
      chatRow("a-delete", "user-alice", "alpha-delete"),
      chatRow("a-trail", "user-alice", "alpha-trail"),
      chatRow("b-9", "user-bob", "beta-topic"),
      chatRow("d-1", "user-deleter", "deleter-only"),
      chatRow("s-1", "user-survivor", "survivor-only"),
    ]);
  await db
    .insert(schema.chatMessage)
    .values([
      messageRow("m-c", "z3", "user-alice", "later-alice"),
      messageRow("m-a", "z3", "user-alice", "alice-secret-body"),
      messageRow("m-b", "z3", "user-alice", "middle-alice"),
      messageRow("t-c", "a-trail", "user-alice", "trail-later"),
      messageRow("t-a", "a-trail", "user-alice", "trail-early"),
      messageRow("t-b", "a-trail", "user-alice", "trail-middle"),
      messageRow("b-m", "b-9", "user-bob", "bob-secret-body", [
        { type: "file", url: "https://example.invalid/bob-private-file.png" },
      ]),
    ]);
  await db.insert(schema.account).values({
    accessToken: "account-token-should-not-export",
    accountId: "github-alice",
    createdAt: tiedAt,
    id: "account-alice",
    providerId: "github",
    updatedAt: tiedAt,
    userId: "user-alice",
  });
  await db.insert(schema.usageRecord).values([
    {
      chatId: "z3",
      createdAt: tiedAt,
      id: "usage-alice",
      userId: "user-alice",
    },
    {
      chatId: "b-9",
      createdAt: tiedAt,
      id: "usage-bob",
      userId: "user-bob",
    },
  ]);
}, 30_000);

afterAll(async () => {
  if (closeDb) {
    await closeDb();
  }
  if (resetAuthCache) {
    resetAuthCache();
  }
  if (socket) {
    await socket.stop();
  }
  if (database) {
    await database.close();
  }
});

function userRow(id: string, name: string, email: string, githubLogin: string) {
  return {
    createdAt: tiedAt,
    email,
    emailVerified: true,
    githubLogin,
    id,
    name,
    updatedAt: tiedAt,
  };
}

function chatRow(id: string, userId: string, title: string) {
  return {
    createdAt: tiedAt,
    id,
    title,
    updatedAt: tiedAt,
    userId,
    visibility: "private" as const,
  };
}

function messageRow(
  id: string,
  chatId: string,
  userId: string,
  text: string,
  parts: unknown[] = [{ text, type: "text" }],
) {
  return {
    attachments: [],
    chatId,
    createdAt: tiedAt,
    id,
    parts,
    role: "user",
    updatedAt: tiedAt,
    userId,
  };
}

async function insertSession(userId: string, token: string, expiresAt?: Date) {
  await db.insert(sessionTable).values({
    createdAt: tiedAt,
    expiresAt: expiresAt ?? new Date(Date.now() + 86_400_000),
    id: `session-${token}`,
    token,
    updatedAt: tiedAt,
    userId,
  });
}

async function cookieHeader(token: string) {
  const auth = getAuth();
  if (!auth) {
    throw new Error("auth did not configure");
  }
  const context = await auth.$context;
  const signature = await makeSignature(token, secret);
  const headers = new Headers();
  headers.set(
    "cookie",
    `${context.authCookies.sessionToken.name}=${token}.${signature}`,
  );
  headers.set("origin", "http://127.0.0.1:3000");
  return headers;
}

function request(
  path: string,
  headers: Headers,
  method = "GET",
  body?: string,
) {
  return new NextRequest(`http://127.0.0.1:3000${path}`, {
    body,
    headers,
    method,
  });
}

async function bodyOf(response: Response) {
  const text = await response.text();
  return {
    json: text.length > 0 ? (JSON.parse(text) as unknown) : null,
    text,
  };
}

function idsOf(json: unknown) {
  if (!json || typeof json !== "object" || !("chats" in json)) {
    return [];
  }
  const chats = json.chats;
  if (!Array.isArray(chats)) {
    return [];
  }
  return chats.map((chat) => {
    if (!chat || typeof chat !== "object" || !("id" in chat)) {
      return "";
    }
    return typeof chat.id === "string" ? chat.id : "";
  });
}

test("credits derive identity from the real invited session and return a private disabled view", async () => {
  const { GET } = await import("../app/api/credits/route");
  const anonymous = await GET(
    request("/api/credits?userId=user-alice", new Headers()),
  );
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get("cache-control")).toBe("no-store");
  const alice = await cookieHeader("alice-token");
  const own = await GET(request("/api/credits?userId=user-bob", alice));
  expect(own.status).toBe(200);
  expect(own.headers.get("cache-control")).toBe("no-store");
  const body = await own.json();
  expect(body).toMatchObject({
    funding: "platform",
    state: "disabled",
    configured: false,
    allowanceMicrodollars: 500000,
    remainingMicrodollars: 0,
    creditMicrodollars: 100000,
  });
  expect(JSON.stringify(body)).not.toContain("user-bob");
  expect(JSON.stringify(body)).not.toContain("user-alice");
  expect(JSON.stringify(body)).not.toContain("monthly");
});

test("history pages tied timestamps without another user's titles", async () => {
  const headers = await cookieHeader("alice-token");
  const first = await bodyOf(
    await historyGet(request("/api/history?limit=1", headers)),
  );
  expect(first.json).toMatchObject({
    chats: [{ id: "z3", title: "alphz3" }],
    hasMore: true,
  });
  expect(first.text).not.toContain("beta-topic");
  expect(first.text).not.toContain("bob-secret-body");

  const second = await bodyOf(
    await historyGet(request("/api/history?limit=1&ending_before=z3", headers)),
  );
  expect(idsOf(second.json)).toEqual(["z2"]);
  const third = await bodyOf(
    await historyGet(request("/api/history?limit=1&ending_before=z2", headers)),
  );
  expect(idsOf(third.json)).toEqual(["z1"]);
  const newer = await bodyOf(
    await historyGet(
      request("/api/history?limit=10&starting_after=z1", headers),
    ),
  );
  expect(idsOf(newer.json)).toEqual(["z3", "z2"]);

  const hidden = await bodyOf(
    await historyGet(request("/api/history?q=beta-topic", headers)),
  );
  expect(idsOf(hidden.json)).toEqual([]);
  const found = await bodyOf(
    await historyGet(request("/api/history?q=alphz3", headers)),
  );
  expect(idsOf(found.json)).toEqual(["z3"]);
  const literal = await bodyOf(
    await historyGet(
      request(`/api/history?q=${encodeURIComponent("%_")}`, headers),
    ),
  );
  expect(idsOf(literal.json)).toEqual(["z0"]);
  const both = await historyGet(
    request("/api/history?starting_after=z1&ending_before=z3", headers),
  );
  expect(both.status).toBe(400);
  expect((await bodyOf(both)).json).toEqual({
    error: { id: "invalid_cursor" },
  });
});

function historyPage(json: unknown) {
  if (!json || typeof json !== "object" || !("hasMore" in json)) {
    return { hasMore: false, ids: [] as string[] };
  }
  return { hasMore: json.hasMore === true, ids: idsOf(json) };
}

function messageIds(json: unknown) {
  if (!json || typeof json !== "object" || !("messages" in json)) {
    return [];
  }
  const messages = json.messages;
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object" || !("id" in message)) {
      return [];
    }
    return typeof message.id === "string" ? [message.id] : [];
  });
}

test("history cursors cross four sub-millisecond pages without gaps", async () => {
  await db.execute(sql`
    insert into public.chat (
      id, title, user_id, visibility, created_at, updated_at
    ) values
      ('p0', 'page-0', 'user-alice', 'private', timestamp '2026-06-01 00:00:00.100001', timestamp '2026-06-01 00:00:00.100001'),
      ('p1', 'page-1', 'user-alice', 'private', timestamp '2026-06-01 00:00:00.100002', timestamp '2026-06-01 00:00:00.100002'),
      ('p2', 'page-2', 'user-alice', 'private', timestamp '2026-06-01 00:00:00.100003', timestamp '2026-06-01 00:00:00.100003'),
      ('p3', 'page-3', 'user-alice', 'private', timestamp '2026-06-01 00:00:00.100004', timestamp '2026-06-01 00:00:00.100004'),
      ('p4', 'page-4', 'user-alice', 'private', timestamp '2026-06-01 00:00:00.100005', timestamp '2026-06-01 00:00:00.100005'),
      ('p5', 'page-5', 'user-alice', 'private', timestamp '2026-06-01 00:00:00.100006', timestamp '2026-06-01 00:00:00.100006'),
      ('p6', 'page-6', 'user-alice', 'private', timestamp '2026-06-01 00:00:00.100007', timestamp '2026-06-01 00:00:00.100007'),
      ('p7', 'page-7', 'user-alice', 'private', timestamp '2026-06-01 00:00:00.100008', timestamp '2026-06-01 00:00:00.100008'),
      ('p8', 'page-8', 'user-alice', 'private', timestamp '2026-06-01 00:00:00.100009', timestamp '2026-06-01 00:00:00.100009'),
      ('p9', 'page-9', 'user-alice', 'private', timestamp '2026-06-01 00:00:00.100010', timestamp '2026-06-01 00:00:00.100010'),
      ('p-bob', 'bob-micro-title', 'user-bob', 'private', timestamp '2026-06-01 00:00:00.100007', timestamp '2026-06-01 00:00:00.100007')
  `);
  await db.execute(sql`
    insert into public.chat (id, title, user_id, visibility)
    values ('p-clock', 'bob-clock-title', 'user-bob', 'private')
  `);
  const headers = await cookieHeader("alice-token");
  const older1 = historyPage(
    (
      await bodyOf(
        await historyGet(request("/api/history?limit=2&q=page-", headers)),
      )
    ).json,
  );
  const older2 = historyPage(
    (
      await bodyOf(
        await historyGet(
          request("/api/history?limit=2&q=page-&ending_before=p8", headers),
        ),
      )
    ).json,
  );
  const older3 = historyPage(
    (
      await bodyOf(
        await historyGet(
          request("/api/history?limit=2&q=page-&ending_before=p6", headers),
        ),
      )
    ).json,
  );
  const older4 = historyPage(
    (
      await bodyOf(
        await historyGet(
          request("/api/history?limit=2&q=page-&ending_before=p4", headers),
        ),
      )
    ).json,
  );
  const older5 = historyPage(
    (
      await bodyOf(
        await historyGet(
          request("/api/history?limit=2&q=page-&ending_before=p2", headers),
        ),
      )
    ).json,
  );
  expect(older1).toEqual({ hasMore: true, ids: ["p9", "p8"] });
  expect(older2).toEqual({ hasMore: true, ids: ["p7", "p6"] });
  expect(older3).toEqual({ hasMore: true, ids: ["p5", "p4"] });
  expect(older4).toEqual({ hasMore: true, ids: ["p3", "p2"] });
  expect(older5).toEqual({ hasMore: false, ids: ["p1", "p0"] });

  const newer1 = historyPage(
    (
      await bodyOf(
        await historyGet(
          request("/api/history?limit=2&q=page-&starting_after=p0", headers),
        ),
      )
    ).json,
  );
  const newer2 = historyPage(
    (
      await bodyOf(
        await historyGet(
          request("/api/history?limit=2&q=page-&starting_after=p2", headers),
        ),
      )
    ).json,
  );
  const newer3 = historyPage(
    (
      await bodyOf(
        await historyGet(
          request("/api/history?limit=2&q=page-&starting_after=p4", headers),
        ),
      )
    ).json,
  );
  const newer4 = historyPage(
    (
      await bodyOf(
        await historyGet(
          request("/api/history?limit=2&q=page-&starting_after=p6", headers),
        ),
      )
    ).json,
  );
  const newer5 = historyPage(
    (
      await bodyOf(
        await historyGet(
          request("/api/history?limit=2&q=page-&starting_after=p8", headers),
        ),
      )
    ).json,
  );
  expect(newer1).toEqual({ hasMore: true, ids: ["p2", "p1"] });
  expect(newer2).toEqual({ hasMore: true, ids: ["p4", "p3"] });
  expect(newer3).toEqual({ hasMore: true, ids: ["p6", "p5"] });
  expect(newer4).toEqual({ hasMore: true, ids: ["p8", "p7"] });
  expect(newer5).toEqual({ hasMore: false, ids: ["p9"] });

  const foreignOlder = await historyGet(
    request("/api/history?ending_before=p-bob", headers),
  );
  const foreignNewer = await historyGet(
    request("/api/history?starting_after=p-clock", headers),
  );
  expect(foreignOlder.status).toBe(404);
  expect(foreignNewer.status).toBe(404);
  expect((await bodyOf(foreignOlder)).json).toEqual({
    error: { id: "not_found" },
  });
  const hidden = await bodyOf(
    await historyGet(request("/api/history?q=bob-micro-title", headers)),
  );
  expect(hidden.text).not.toContain("bob-micro-title");
  expect(hidden.text).not.toContain("bob-clock-title");
  expect(idsOf(hidden.json)).toEqual([]);
});

test("message cursors and trailing delete keep sub-millisecond neighbors", async () => {
  await db.execute(sql`
    insert into public.chat (
      id, title, user_id, visibility, created_at, updated_at
    ) values (
      'p-msg',
      'micro-chat',
      'user-alice',
      'private',
      timestamp '2026-07-01 00:00:00.300000',
      timestamp '2026-07-01 00:00:00.300000'
    )
  `);
  await db.execute(sql`
    insert into public.chat_message (
      id, chat_id, user_id, role, parts, attachments, created_at, updated_at
    ) values
      ('n0', 'p-msg', 'user-alice', 'user', '[{"type":"text","text":"micro-early"}]'::jsonb, '[]'::jsonb, timestamp '2026-07-01 00:00:00.200001', timestamp '2026-07-01 00:00:00.200001'),
      ('n1', 'p-msg', 'user-alice', 'user', '[{"type":"text","text":"micro-anchor"}]'::jsonb, '[]'::jsonb, timestamp '2026-07-01 00:00:00.200002', timestamp '2026-07-01 00:00:00.200002'),
      ('n2', 'p-msg', 'user-alice', 'user', '[{"type":"text","text":"micro-next"}]'::jsonb, '[]'::jsonb, timestamp '2026-07-01 00:00:00.200003', timestamp '2026-07-01 00:00:00.200003'),
      ('n3', 'p-msg', 'user-alice', 'user', '[{"type":"text","text":"micro-last"}]'::jsonb, '[]'::jsonb, timestamp '2026-07-01 00:00:00.200004', timestamp '2026-07-01 00:00:00.200004'),
      ('n-bob', 'b-9', 'user-bob', 'user', '[{"type":"text","text":"bob-micro-keep"}]'::jsonb, '[]'::jsonb, timestamp '2026-07-01 00:00:00.200003', timestamp '2026-07-01 00:00:00.200003')
  `);
  await db.execute(sql`
    insert into public.chat_message (
      id, chat_id, user_id, role, parts, attachments
    ) values (
      'n-default',
      'p-msg',
      'user-alice',
      'user',
      '[{"type":"text","text":"micro-default"}]'::jsonb,
      '[]'::jsonb
    )
  `);
  const alice = await cookieHeader("alice-token");
  const next = await bodyOf(
    await messages.GET(
      request("/api/messages?chatId=p-msg&limit=1&after=n1", alice),
    ),
  );
  expect(next.json).toMatchObject({
    hasMore: true,
    messages: [{ id: "n2" }],
  });
  expect(messageIds(next.json)).toEqual(["n2"]);
  const rest = await bodyOf(
    await messages.GET(
      request("/api/messages?chatId=p-msg&limit=10&after=n2", alice),
    ),
  );
  expect(messageIds(rest.json)).toEqual(["n3", "n-default"]);
  const foreign = await messages.GET(
    request("/api/messages?chatId=p-msg&after=n-bob", alice),
  );
  expect(foreign.status).toBe(404);
  expect((await bodyOf(foreign)).text).not.toContain("bob-micro-keep");

  currentHeaders = await cookieHeader("bob-token");
  expect(await rejectionOf(deleteChatMessages("n1"))).toMatchObject({
    id: "not_found",
  });
  currentHeaders = alice;
  await deleteChatMessages("n1");
  const remaining = await db
    .select({ id: messageTable.id })
    .from(messageTable)
    .where(eq(messageTable.chatId, "p-msg"));
  expect(remaining.map((row) => row.id).sort()).toEqual(["n0", "n1"]);
  const kept = await db
    .select({ id: messageTable.id })
    .from(messageTable)
    .where(eq(messageTable.id, "n-bob"));
  expect(kept).toHaveLength(1);
});

test("message retrieval is chronological and batches stay owner-scoped", async () => {
  const alice = await cookieHeader("alice-token");
  const bob = await cookieHeader("bob-token");
  const page = await bodyOf(
    await messages.GET(request("/api/messages?chatId=z3&limit=2", alice)),
  );
  expect(page.json).toMatchObject({
    hasMore: true,
    messages: [{ id: "m-a" }, { id: "m-b" }],
  });
  const rest = await bodyOf(
    await messages.GET(
      request("/api/messages?chatId=z3&limit=10&after=m-b", alice),
    ),
  );
  expect(rest.json).toMatchObject({
    hasMore: false,
    messages: [{ id: "m-c" }],
  });

  const denied = await messages.GET(request("/api/messages?chatId=z3", bob));
  const deniedBody = await bodyOf(denied);
  expect(denied.status).toBe(403);
  expect(deniedBody.json).toEqual({ error: { id: "forbidden" } });
  expect(deniedBody.text).not.toContain("alice-secret-body");

  const library = await bodyOf(
    await libraryGet(request("/api/library", alice)),
  );
  expect(library.text).not.toContain("bob-private-file");
  expect(library.text).not.toContain("bob-secret-body");

  const before = await db
    .select({ id: messageTable.id })
    .from(messageTable)
    .where(eq(messageTable.chatId, "b-9"));
  const rejected = await messages.POST(
    request(
      "/api/messages",
      alice,
      "POST",
      JSON.stringify({
        messages: [
          {
            chatId: "z3",
            id: "m-owned-new",
            parts: [{ text: "owned", type: "text" }],
            role: "user",
          },
          {
            chatId: "b-9",
            id: "m-foreign-new",
            parts: [{ text: "foreign", type: "text" }],
            role: "user",
          },
        ],
      }),
    ),
  );
  expect(rejected.status).toBe(403);
  expect((await bodyOf(rejected)).json).toEqual({ error: { id: "forbidden" } });
  const after = await db
    .select({ id: messageTable.id })
    .from(messageTable)
    .where(eq(messageTable.chatId, "b-9"));
  expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
  const ownedNew = await db
    .select({ id: messageTable.id })
    .from(messageTable)
    .where(eq(messageTable.id, "m-owned-new"));
  expect(ownedNew).toEqual([]);
});

test("rename and delete refuse another user's conversation", async () => {
  const alice = await cookieHeader("alice-token");
  const bob = await cookieHeader("bob-token");
  const foreignRename = await chatRoutes.PATCH(
    request(
      "/api/chat",
      bob,
      "PATCH",
      JSON.stringify({ id: "a-delete", title: "stolen" }),
    ),
  );
  expect(foreignRename.status).toBe(403);
  const unchanged = await db
    .select({ title: chatTable.title })
    .from(chatTable)
    .where(eq(chatTable.id, "a-delete"));
  expect(unchanged[0]?.title).toBe("alpha-delete");

  const renamed = await chatRoutes.PATCH(
    request(
      "/api/chat",
      alice,
      "PATCH",
      JSON.stringify({ id: "a-delete", title: "alpha-renamed" }),
    ),
  );
  expect(renamed.status).toBe(200);
  expect((await bodyOf(renamed)).json).toMatchObject({
    id: "a-delete",
    title: "alpha-renamed",
  });

  const foreignDelete = await chatRoutes.DELETE(
    request("/api/chat?id=a-delete", bob, "DELETE"),
  );
  expect(foreignDelete.status).toBe(403);
  const stillThere = await db
    .select({ id: chatTable.id })
    .from(chatTable)
    .where(eq(chatTable.id, "a-delete"));
  expect(stillThere).toHaveLength(1);

  const removed = await chatRoutes.DELETE(
    request("/api/chat?id=a-delete", alice, "DELETE"),
  );
  expect(removed.status).toBe(200);
  const gone = await db
    .select({ id: chatTable.id })
    .from(chatTable)
    .where(eq(chatTable.id, "a-delete"));
  expect(gone).toEqual([]);
});

test("trailing delete uses the session and keeps the other user's messages", async () => {
  const bob = await cookieHeader("bob-token");
  currentHeaders = bob;
  expect(await rejectionOf(deleteChatMessages("t-b"))).toMatchObject({
    id: "not_found",
  });
  const before = await db
    .select({ id: messageTable.id })
    .from(messageTable)
    .where(eq(messageTable.chatId, "a-trail"));
  expect(before.map((row) => row.id).sort()).toEqual(["t-a", "t-b", "t-c"]);

  currentHeaders = await cookieHeader("alice-token");
  await deleteChatMessages("t-b");
  const after = await db
    .select({ id: messageTable.id })
    .from(messageTable)
    .where(eq(messageTable.chatId, "a-trail"));
  expect(after.map((row) => row.id).sort()).toEqual(["t-a", "t-b"]);
});

test("uninvited sessions are refused and alternate sign-in does not create access", async () => {
  const auth = getAuth();
  if (!auth) {
    throw new Error("auth did not configure");
  }
  const context = await auth.$context;
  const created = await context.internalAdapter.createSession("user-carol");
  expect(created).toBeNull();
  const carolSessions = await db
    .select({ id: sessionTable.id })
    .from(sessionTable)
    .where(eq(sessionTable.userId, "user-carol"));
  expect(carolSessions).toEqual([]);

  await insertSession("user-carol", "carol-token");
  const carol = await cookieHeader("carol-token");
  const denied = await historyGet(request("/api/history", carol));
  const deniedBody = await bodyOf(denied);
  expect(denied.status).toBe(403);
  expect(deniedBody.json).toEqual({ error: { id: "invite_required" } });
  expect(deniedBody.text).not.toContain("alphz3");
  expect(deniedBody.text).not.toContain("beta-topic");
  const revoked = await db
    .select({ id: sessionTable.id })
    .from(sessionTable)
    .where(eq(sessionTable.token, "carol-token"));
  expect(revoked).toEqual([]);
  const second = await historyGet(request("/api/history", carol));
  expect(second.status).toBe(401);
  expect((await bodyOf(second)).json).toEqual({
    error: { id: "unauthenticated" },
  });

  const usersBefore = await db.select({ id: userTable.id }).from(userTable);
  const emailHeaders = new Headers(carol);
  emailHeaders.set("content-type", "application/json");
  const signIn = await authRoutes.POST(
    request(
      "/api/auth/sign-in/email",
      emailHeaders,
      "POST",
      JSON.stringify({
        email: "carol@example.com",
        password: "not-a-real-password",
      }),
    ),
  );
  const signUp = await authRoutes.POST(
    request(
      "/api/auth/sign-up/email",
      emailHeaders,
      "POST",
      JSON.stringify({
        email: "newcomer@example.com",
        name: "Newcomer",
        password: "not-a-real-password",
      }),
    ),
  );
  expect(signIn.status).toBe(403);
  expect(signUp.status).toBe(403);
  expect((await bodyOf(signIn)).text).not.toContain("beta-topic");
  expect((await bodyOf(signUp)).text).not.toContain(
    "account-token-should-not-export",
  );
  const usersAfter = await db.select({ id: userTable.id }).from(userTable);
  expect(usersAfter.map((row) => row.id).sort()).toEqual(
    usersBefore.map((row) => row.id).sort(),
  );

  const anonymous = await historyGet(request("/api/history", new Headers()));
  expect(anonymous.status).toBe(401);
  expect((await bodyOf(anonymous)).json).toEqual({
    error: { id: "unauthenticated" },
  });
  const sessionLookup = await authRoutes.GET(
    request("/api/auth/get-session", new Headers()),
  );
  expect(await sessionLookup.json()).toBeNull();
});

test("expired and signed-out sessions cannot read history", async () => {
  await insertSession(
    "user-alice",
    "alice-expired",
    new Date(Date.now() - 60_000),
  );
  const expired = await cookieHeader("alice-expired");
  const expiredResponse = await historyGet(request("/api/history", expired));
  expect(expiredResponse.status).toBe(401);
  expect((await bodyOf(expiredResponse)).json).toEqual({
    error: { id: "unauthenticated" },
  });

  const headers = await cookieHeader("alice-token");
  const signedOut = await authRoutes.POST(
    request("/api/auth/sign-out", headers, "POST"),
  );
  expect(signedOut.status).toBe(200);
  const after = await historyGet(request("/api/history", headers));
  expect(after.status).toBe(401);
  const remaining = await db
    .select({ id: sessionTable.id })
    .from(sessionTable)
    .where(eq(sessionTable.token, "alice-token"));
  expect(remaining).toEqual([]);
});

test("export and account deletion stay inside the signed-in user", async () => {
  const alice = await cookieHeader("bob-token");
  const own = await bodyOf(
    await exportGet(request("/api/account/export", alice)),
  );
  expect(own.text).toContain("beta-topic");
  expect(own.text).not.toContain("alphz3");
  expect(own.text).not.toContain("account-token-should-not-export");
  expect(own.text).not.toContain("usage-alice");
  expect(own.text).toContain("usage-bob");

  const deleter = await cookieHeader("deleter-token");
  const survivor = await cookieHeader("survivor-token");
  const deleted = await accountRoutes.DELETE(
    request("/api/account", deleter, "DELETE"),
  );
  expect(deleted.status).toBe(200);
  expect((await bodyOf(deleted)).json).toEqual({ deleted: true });
  const survivorHistory = await bodyOf(
    await historyGet(request("/api/history", survivor)),
  );
  expect(idsOf(survivorHistory.json)).toEqual(["s-1"]);
  expect(survivorHistory.text).toContain("survivor-only");
  expect(survivorHistory.text).not.toContain("deleter-only");
  const deleterAgain = await historyGet(request("/api/history", deleter));
  expect(deleterAgain.status).toBe(401);
  const deleterRow = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, "user-deleter"));
  expect(deleterRow).toEqual([]);
  const survivorRow = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, "user-survivor"));
  expect(survivorRow).toHaveLength(1);
});

test("object keys from another user are rejected before storage", async () => {
  const alice = await cookieHeader("bob-token");
  const foreign = await uploadRoutes.DELETE(
    request("/api/upload?key=user-alice/notes.txt", alice, "DELETE"),
  );
  expect(foreign.status).toBe(403);
  expect((await bodyOf(foreign)).json).toEqual({ error: { id: "forbidden" } });
  const owned = await uploadRoutes.DELETE(
    request("/api/upload?key=user-bob/notes.txt", alice, "DELETE"),
  );
  expect(owned.status).toBe(503);
  expect((await bodyOf(owned)).json).toEqual({
    error: { id: "storage_unconfigured" },
  });
  const missing = await uploadRoutes.POST(
    request("/api/upload", alice, "POST", JSON.stringify({})),
  );
  expect(missing.status).toBe(400);
  expect((await bodyOf(missing)).json).toEqual({
    error: { id: "invalid_object" },
  });
});
