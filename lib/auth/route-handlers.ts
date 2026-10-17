import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import type { getAuth } from "@/lib/auth/server";

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
