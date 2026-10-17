import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/server";
import { logErrorId } from "@/lib/errors";

function unconfigured() {
  return NextResponse.json(
    {
      error: {
        id: "auth_unconfigured",
        message: "Authentication is not configured.",
      },
    },
    { status: 503 },
  );
}

type AuthInstance = NonNullable<ReturnType<typeof getAuth>>;

export function authRouteHandlers(auth: AuthInstance | null) {
  if (!auth) {
    return { GET: unconfigured, POST: unconfigured };
  }
  return toNextJsHandler(auth);
}

async function dispatch(request: Request, method: "GET" | "POST") {
  try {
    const handler = authRouteHandlers(getAuth())[method];
    return await handler(request);
  } catch {
    logErrorId("auth_failed");
    return NextResponse.json({ error: { id: "auth_failed" } }, { status: 500 });
  }
}

export function GET(request: Request) {
  return dispatch(request, "GET");
}

export function POST(request: Request) {
  return dispatch(request, "POST");
}
