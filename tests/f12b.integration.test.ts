import { expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import * as XLSX from "xlsx";
import { sampleChart } from "../lib/artifacts/chart-spec";
import { sampleTable } from "../lib/artifacts/table-spec";
import { betaFixture, env, secret } from "./helpers/beta-fixture";
import { rejectionOf } from "./helpers/rejection";

mock.module("server-only", () => ({}));
const { GET, POST } = await import("../app/(chat)/api/artifacts/route");
const { mutateArtifact, readArtifact, readArtifactRevision } = await import(
  "../lib/artifacts/service"
);
const { exportOwnedAccount } = await import("../lib/actions/account/account");

const first = sampleTable();
first.rows[0].values = [
  "-42",
  -42,
  true,
  '  =WEBSERVICE("https://evil.invalid")',
];
const firstSource = JSON.stringify(first, null, 2);
const create = {
  action: "create" as const,
  chatId: "table-chat",
  messageId: "table-answer",
  kind: "table" as const,
  title: "Typed table",
};

async function fixture() {
  const f = await betaFixture();
  await f.db.$client
    .unsafe(
      `INSERT INTO chat(id,user_id,title) VALUES ('table-chat','alice','Table'),('bob-table','bob','Bob'); INSERT INTO chat_message(id,chat_id,user_id,role,parts,attachments) VALUES ('table-answer','table-chat','alice','assistant','[]','[]'),('bad-table','table-chat','alice','assistant','[{"type":"text","text":"{}"}]','[]'),('table-user','table-chat','alice','user','[]','[]'),('bob-table-answer','bob-table','bob','assistant','[]','[]')`,
    )
    .simple();
  await f.db.$client.unsafe(
    "UPDATE chat_message SET parts=$1::jsonb WHERE id IN ('table-answer','table-user','bob-table-answer')",
    [
      JSON.stringify([
        { type: "text", text: `\`\`\`table\n${firstSource}\n\`\`\`` },
      ]),
    ],
  );
  return f;
}

test("F12-B owned explicit CSV revisions stay immutable and preserve typed negative numbers", async () => {
  const f = await fixture();
  const created = await POST(await f.request("/api/artifacts", create));
  expect(created.status).toBe(200);
  const { id } = await created.json();
  expect(await readArtifact("alice", id)).toMatchObject({
    kind: "table",
    version: 1,
    content: firstSource,
  });

  const source = await GET(
    await f.request(`/api/artifacts?id=${id}&download=source`),
  );
  expect(source.status).toBe(200);
  expect(source.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  expect(source.headers.get("content-disposition")).toContain(
    'filename="Typed-table.table.json"',
  );
  expect(await source.text()).toBe(firstSource);

  const csv1 = await GET(
    await f.request(`/api/artifacts?id=${id}&version=1&download=csv`),
  );
  expect(csv1.status).toBe(200);
  expect(csv1.headers.get("content-type")).toBe(
    "text/csv; charset=utf-8; header=present",
  );
  expect(csv1.headers.get("content-disposition")).toContain(
    'filename="Typed-table-v1.csv"',
  );
  expect(csv1.headers.get("cache-control")).toBe("private, no-store");
  expect(csv1.headers.get("content-security-policy")).toContain("sandbox");
  expect(csv1.headers.get("referrer-policy")).toBe("no-referrer");
  const csvBytes = new Uint8Array(await csv1.arrayBuffer());
  expect(Number(csv1.headers.get("content-length"))).toBe(csvBytes.byteLength);
  const csvText = new TextDecoder().decode(csvBytes);
  expect(csvText).toContain('"\t-42",-42,TRUE');
  expect(csvText).toContain("\t  =WEBSERVICE");

  const second = sampleTable();
  second.title = "Second revision";
  second.rows[0].values = ["Q1", 99, false, "plain"];
  const secondSource = JSON.stringify(second);
  await mutateArtifact("alice", {
    action: "save",
    id,
    expectedVersion: 1,
    title: "Changed table",
    content: secondSource,
  });
  expect(
    await rejectionOf(
      mutateArtifact("alice", {
        action: "save",
        id,
        expectedVersion: 1,
        title: "Stale editor",
        content: secondSource,
      }),
    ),
  ).toMatchObject({ id: "artifact_conflict" });
  expect(await readArtifactRevision("alice", id, 1)).toMatchObject({
    title: "Typed table",
    content: firstSource,
  });
  const csv1Again = await GET(
    await f.request(`/api/artifacts?id=${id}&version=1&download=csv`),
  );
  expect(new Uint8Array(await csv1Again.arrayBuffer())).toEqual(csvBytes);
  expect(f.seen).toHaveLength(0);
});

test("F12-B owned XLSX is one typed sheet and table restore/account export reuse artifact history", async () => {
  const f = await fixture();
  const { id } = await mutateArtifact("alice", create);
  const xlsx = await GET(
    await f.request(`/api/artifacts?id=${id}&version=1&download=xlsx`),
  );
  expect(xlsx.status).toBe(200);
  expect(xlsx.headers.get("content-type")).toBe(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  expect(xlsx.headers.get("content-disposition")).toContain(
    'filename="Typed-table-v1.xlsx"',
  );
  const workbook = XLSX.read(await xlsx.arrayBuffer(), {
    type: "array",
    cellFormula: true,
  });
  expect(workbook.SheetNames).toEqual(["Table"]);
  expect(workbook.Sheets.Table.B2).toMatchObject({ t: "s", v: "-42" });
  expect(workbook.Sheets.Table.C2).toMatchObject({ t: "n", v: -42 });
  expect(workbook.Sheets.Table.D2).toMatchObject({ t: "b", v: true });
  expect(workbook.Sheets.Table.E2.f).toBeUndefined();
  expect(workbook.Sheets.Table.E2.l).toBeUndefined();

  const second = sampleTable();
  second.rows[0].values = ["Q1", 99, false, "plain"];
  await mutateArtifact("alice", {
    action: "save",
    id,
    expectedVersion: 1,
    title: "Changed table",
    content: JSON.stringify(second),
  });
  await mutateArtifact("alice", {
    action: "restore",
    id,
    expectedVersion: 2,
    version: 1,
  });
  expect((await readArtifact("alice", id)).revisions[0].restoredFrom).toBe(1);
  const account = await exportOwnedAccount("alice");
  expect(account.artifacts.map((artifact) => artifact.kind)).toEqual(["table"]);
  expect(account.artifactRevisions).toHaveLength(3);
  expect(f.seen).toHaveLength(0);
});

test("F12-B table exports deny guests and other owners and reject ambiguous, forged, or malformed revisions", async () => {
  const f = await fixture();
  expect(
    (
      await POST(
        await f.request("/api/artifacts", {
          ...create,
          messageId: "bad-table",
        }),
      )
    ).status,
  ).toBe(400);
  const { id } = await mutateArtifact("alice", create);
  for (const suffix of [
    `id=${id}&download=csv`,
    `id=${id}&version=0&download=csv`,
    `id=${id}&version=41&download=xlsx`,
    `id=${id}&version=1.5&download=csv`,
    `id=${id}&version=1&download=csv`,
  ]) {
    const user = suffix.endsWith("version=1&download=csv") ? "bob" : "alice";
    expect(
      (await GET(await f.request(`/api/artifacts?${suffix}`, undefined, user)))
        .status,
    ).toBe(user === "bob" ? 404 : 400);
  }
  expect(
    (
      await GET(
        new Request(
          `${env.BETTER_AUTH_URL}/api/artifacts?id=${id}&version=1&download=csv`,
        ),
      )
    ).status,
  ).toBe(401);
  const { signedGuest } = await import("../lib/credits/guest");
  expect(
    (
      await GET(
        new Request(
          `${env.BETTER_AUTH_URL}/api/artifacts?id=${id}&version=1&download=xlsx`,
          {
            headers: {
              cookie: `__Host-galaxy-guest=${signedGuest(secret)}`,
            },
          },
        ),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await POST(
        await f.request("/api/artifacts", {
          action: "save",
          id,
          expectedVersion: 1,
          title: "Formula object",
          content: JSON.stringify({
            ...first,
            rows: [
              {
                label: "Bad",
                values: [{ formula: "1+1" }, -42, true, "text"],
              },
            ],
          }),
        }),
      )
    ).status,
  ).toBe(400);
  expect((await readArtifact("alice", id)).version).toBe(1);

  const chartSource = JSON.stringify(sampleChart());
  await f.db.$client.begin(async (tx) => {
    await tx
      .unsafe(
        "INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES ('chart-forge','alice','table-chat','table-answer','chart',1)",
      )
      .simple();
    await tx.unsafe(
      "INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) VALUES ('chart-forge','alice',1,'Chart',$1)",
      [chartSource],
    );
  });
  expect(
    (
      await GET(
        await f.request(
          "/api/artifacts?id=chart-forge&version=1&download=xlsx",
        ),
      )
    ).status,
  ).toBe(400);

  await f.db.$client.unsafe(
    "INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) VALUES ($1,'alice',2,'Malformed','{}')",
    [id],
  );
  expect(
    (
      await GET(
        await f.request(`/api/artifacts?id=${id}&version=2&download=csv`),
      )
    ).status,
  ).toBe(400);
  expect(
    await rejectionOf(
      mutateArtifact("alice", {
        action: "restore",
        id,
        expectedVersion: 1,
        version: 2,
      }),
    ),
  ).toMatchObject({ id: "invalid_artifact" });
  expect(f.seen).toHaveLength(0);
});

test("F12-B migration 0010 preserves populated F12 history and guards while allowing only the table kind", async () => {
  const db = await PGlite.create();
  try {
    for (const name of readdirSync("drizzle")
      .filter((name) => name.endsWith(".sql") && name < "0010")
      .sort())
      await db.exec(readFileSync(`drizzle/${name}`, "utf8"));
    await db.exec(
      `INSERT INTO "user"(id,name,email) VALUES ('owner','Owner','owner@example.invalid'); INSERT INTO chat(id,user_id,title) VALUES ('chat','owner','Table'); INSERT INTO chat_message(id,chat_id,user_id,role,parts,attachments) VALUES ('message','chat','owner','assistant','[]','[]'); BEGIN; INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES ('chart','owner','chat','message','chart',1); INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) VALUES ('chart','owner',1,'Chart','{}'); COMMIT;`,
    );
    await db.exec(readFileSync("drizzle/0010_table_artifacts.sql", "utf8"));
    expect(
      (await db.query("SELECT kind FROM artifact WHERE id='chart'")).rows,
    ).toEqual([{ kind: "chart" }]);
    await db.exec(
      `BEGIN; INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES ('table','owner','chat','message','table',1); INSERT INTO artifact_revision(artifact_id,user_id,version,title,content) VALUES ('table','owner',1,'Table','{}'); COMMIT;`,
    );
    expect(
      await rejectionOf(
        db.exec(
          "UPDATE artifact_revision SET content='changed' WHERE artifact_id='table'",
        ),
      ),
    ).toMatchObject({ message: expect.stringContaining("immutable") });
    expect(
      await rejectionOf(
        db.exec("UPDATE artifact SET kind='html' WHERE id='table'"),
      ),
    ).toMatchObject({ message: expect.stringContaining("immutable") });
    expect(
      await rejectionOf(
        db.exec(
          "INSERT INTO artifact(id,user_id,chat_id,message_id,kind,head) VALUES ('bad','owner','chat','message','workbook',1)",
        ),
      ),
    ).toMatchObject({ code: "23514" });
  } finally {
    await db.close();
  }
});
