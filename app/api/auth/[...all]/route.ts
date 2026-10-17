import { NextResponse } from "next/server";
import { authRouteHandlers } from "@/lib/auth/route-handlers";
import { getAuth } from "@/lib/auth/server";
import { logErrorId } from "@/lib/errors";

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
