import { expect, test } from "bun:test";
import { authRouteHandlers } from "../app/api/auth/[...all]/route";

test("unconfigured auth routes do not create a session", async () => {
  const handlers = authRouteHandlers(null);
  const response = await handlers.GET(
    new Request("http://127.0.0.1:3000/api/auth/get-session"),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: {
      id: "auth_unconfigured",
      message: "Authentication is not configured.",
    },
  });
  const posted = await handlers.POST(
    new Request("http://127.0.0.1:3000/api/auth/sign-in/social", {
      body: JSON.stringify({ provider: "github" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  expect(posted.status).toBe(503);
  expect(posted.headers.get("set-cookie")).toBeNull();
});
