import { AppError } from "@/lib/errors";
export function assertSameOrigin(request: Request) {
  let expected: string;
  try {
    expected = new URL(process.env.BETTER_AUTH_URL ?? "").origin;
  } catch {
    throw new AppError("auth_unconfigured", 503);
  }
  if (
    request.headers.get("origin") !== expected ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AppError("invalid_origin", 403);
}
