import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/server";
import { observeRequest } from "@/lib/logger";

export function GET(request: Request) {
  return observeRequest(request, () => toNextJsHandler(getAuth()).GET(request));
}

export function POST(request: Request) {
  return observeRequest(request, () =>
    toNextJsHandler(getAuth()).POST(request),
  );
}
