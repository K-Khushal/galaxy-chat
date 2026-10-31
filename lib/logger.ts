import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
export const requestLog = new AsyncLocalStorage<{
  requestId: string;
  route: string;
}>();
export function log(
  level: "info" | "warn" | "error",
  msg: string,
  durationMs?: number,
) {
  process.stderr.write(
    `${JSON.stringify({ level, msg, ...requestLog.getStore(), durationMs })}\n`,
  );
}
export async function observeRequest(
  request: Request,
  run: () => Promise<Response>,
) {
  const requestId =
    request.headers
      .get("x-vercel-id")
      ?.replace(/[^a-zA-Z0-9:_.-]/g, "")
      .slice(0, 200) || crypto.randomUUID();
  const route = new URL(request.url).pathname.replace(/\/[^/]+/g, (part) =>
    /^(\/api|\/auth|\/chats|\/byok|\/test|\/messages|\/version|\/stop|\/stream|\/account|\/export|\/settings|\/temporary|\/credits|\/search)$/.test(
      part,
    )
      ? part
      : "/[id]",
  );
  return requestLog.run({ requestId, route }, async () => {
    const start = performance.now();
    try {
      const response = await run();
      response.headers.set("x-request-id", requestId);
      return response;
    } finally {
      log("info", "api_request", Math.round(performance.now() - start));
    }
  });
}
