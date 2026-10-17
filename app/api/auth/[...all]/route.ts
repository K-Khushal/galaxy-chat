import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/server";

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

const auth = getAuth();

export const GET = auth ? toNextJsHandler(auth).GET : unconfigured;
export const POST = auth ? toNextJsHandler(auth).POST : unconfigured;
