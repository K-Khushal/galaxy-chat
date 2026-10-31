import { randomUUID } from "node:crypto";
import { grantSignupCredits, hashGrantIdentity } from "@/lib/credits";
import { getDb } from "@/lib/db/client";
import { session, user } from "@/lib/db/schema";
import { testE2eEnabled } from "@/lib/env";

export async function POST() {
  if (!testE2eEnabled()) return new Response(null, { status: 404 });
  const db = getDb();
  const id = randomUUID();
  const token = randomUUID();
  const email = `${id}@example.com`;
  await db
    .insert(user)
    .values({ id, name: "E2E User", email, emailVerified: true });
  await grantSignupCredits(db, id, [
    hashGrantIdentity({ kind: "email", value: email }, "e2e-only"),
  ]);
  await db.insert(session).values({
    id: randomUUID(),
    token,
    userId: id,
    expiresAt: new Date(Date.now() + 3600000),
  });
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/chat",
      "Set-Cookie": `galaxy-e2e=${token}; HttpOnly; SameSite=Strict; Path=/`,
    },
  });
}

export function GET() {
  return new Response(null, { status: testE2eEnabled() ? 204 : 404 });
}
