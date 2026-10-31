// Run with: bun tests/manual/chat-browser.ts (next dev must be on :3000).
// This isolated local proxy reuses M3's PGlite + in-memory Redis + AI SDK mock.
// It is never imported by the app and does not alter production authentication.
import { mock } from "bun:test";

mock.module("server-only", () => ({}));
const { createHarness, call } = await import("../support/harness");
const routes = await import("../../lib/api/chats");
const byok = await import("../../lib/api/byok");
const { chromium, expect: baseExpect } = await import("@playwright/test");
const expect = baseExpect.configure({ timeout: 30000 });
const h = await createHarness();
await h.addUser("local", 100);
h.state.script = {
  words: (
    'A thoughtful Reply.\n\nHere is some **Markdown** and a small example:\n\n```ts\nconst greeting = "Hello";\n```\n\nMath: $$x^2$$.\n\n' +
    "The Reply keeps streaming while you read. ".repeat(60)
  ).split(/(?<=\s)/),
  delayMs: 100,
};
const server = Bun.serve({
  port: 3100,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/"))
      return new Response(null, { status: 404 });
    const [, , kind, id, action] = url.pathname.split("/");
    const handler =
      kind === "byok"
        ? byok.getByokRoute
        : !id
          ? req.method === "POST"
            ? routes.createChatRoute
            : routes.listChatsRoute
          : action === "messages"
            ? routes.sendMessageRoute
            : action === "stream"
              ? routes.resumeStreamRoute
              : action === "stop"
                ? routes.stopRoute
                : action === "version"
                  ? routes.switchVersionRoute
                  : routes.getChatRoute;
    return handler(
      h.ctx,
      new Request(req, {
        headers: new Headers([
          ...req.headers.entries(),
          ["x-test-user", "local"],
        ]),
      }),
      id ?? "",
    );
  },
});
async function tabTo(
  page: import("@playwright/test").Page,
  target: import("@playwright/test").Locator,
) {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error("Keyboard focus did not reach target");
}
const browser = await chromium.launch({ headless: true });
try {
  for (const theme of ["light", "dark"] as const)
    for (const width of [1280, 390]) {
      const result = await call(h, routes.createChatRoute, {
        user: "local",
        body: {},
      });
      const { chat } = await result.json();
      console.log("case", theme, width);
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        colorScheme: theme,
        hasTouch: width === 390,
      });
      page.on("pageerror", (error) => console.log("pageerror", error.message));
      let injectedError: string | undefined;
      await page.route("**/api/**", (route) => {
        if (
          injectedError &&
          route.request().method() === "POST" &&
          route.request().url().endsWith("/messages")
        )
          return route.fulfill({
            status: injectedError === "payload_too_large" ? 413 : 402,
            json: { error: injectedError },
          });
        return route.continue({
          url: route.request().url().replace(":3000", ":3100"),
        });
      });
      await page.addInitScript(
        (theme) => localStorage.setItem("theme", theme),
        theme,
      );
      await page.goto(`http://localhost:3000/design/chat?id=${chat.id}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      const composer = page.getByRole("textbox", {
        name: "Message",
        exact: true,
      });
      await expect(composer).toBeVisible();
      await expect(page.locator("output[aria-live=polite]")).toHaveText("");
      await page.screenshot({
        path: `docs/evidence/m4/${theme}-${width}-empty.png`,
      });
      await tabTo(page, composer);
      await composer.fill("Explain streaming");
      await page.addStyleTag({ content: "nextjs-portal {display:none}" });
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("button", { name: "Stop Reply" }),
      ).toBeVisible();
      await expect(
        page.getByText("A thoughtful Reply.", { exact: false }).first(),
      ).toBeVisible();
      await page.screenshot({
        path: `docs/evidence/m4/${theme}-${width}-streaming.png`,
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("button", { name: "Stop Reply" }),
      ).toBeVisible();
      await page.screenshot({
        path: `docs/evidence/m4/${theme}-${width}-resume.png`,
      });
      await page.addStyleTag({ content: "nextjs-portal {display:none}" });
      await page.getByRole("button", { name: "Stop Reply" }).click();
      await expect(page.getByText("Stopped", { exact: true })).toBeVisible({
        timeout: 20000,
      });
      await page.screenshot({
        path: `docs/evidence/m4/${theme}-${width}-stopped.png`,
      });
      await expect(page.locator("output[aria-live=polite]")).toContainText(
        "A thoughtful Reply.",
      );
      await page.getByRole("button", { name: "Choose model" }).click();
      await page.getByRole("textbox", { name: "Search models" }).fill("Claude");
      await expect(
        page.getByText("Add your OpenRouter key", { exact: true }).first(),
      ).toBeVisible();
      await page.waitForTimeout(400); // Capture the settled dialog, including on mobile.
      await page.screenshot({
        path: `docs/evidence/m4/${theme}-${width}-models.png`,
      });
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("textbox", { name: "Search models" }),
      ).toHaveCount(0);
      h.state.script = { words: ["A new Version."], delayMs: 100 };
      await page.getByRole("button", { name: "Regenerate Reply" }).click();
      await expect(page.getByText("2/2", { exact: true })).toBeVisible({
        timeout: 20000,
      });
      await tabTo(page, page.getByRole("button", { name: "Edit Message" }));
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("textbox", { name: "Edit Message", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Edit Message" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await page
        .getByRole("textbox", { name: "Edit Message", exact: true })
        .fill("Edited Message");
      await page.getByRole("button", { name: "Save and send" }).click();
      await expect(
        page.getByRole("textbox", { name: "Edit Message", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Edited Message", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Send message" }),
      ).toBeVisible({ timeout: 20000 });
      await expect(page.getByText("2/2", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Edit Message" }),
      ).toBeFocused();
      await page.addStyleTag({ content: "nextjs-portal {display:none}" });
      await page
        .getByRole("button", { name: "Previous Version" })
        .first()
        .hover();
      await page.screenshot({
        path: `docs/evidence/m4/${theme}-${width}-versions.png`,
      });
      const saved = await call(h, routes.getChatRoute, {
        user: "local",
        id: chat.id,
      });
      const savedView = await saved.json();
      const reply = savedView.messages.at(-1);
      await h.pg.query("UPDATE message SET status = $1 WHERE id = $2", [
        "interrupted",
        reply.id,
      ]);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        page.getByText("Interrupted", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Send message" }),
      ).toBeVisible({ timeout: 20000 });
      await expect(page.getByText("Interrupted", { exact: true })).toHaveCount(
        0,
      );
      // Keyboard-only Reply actions, Version selection and picker dismissal.
      await tabTo(page, page.getByRole("button", { name: "Copy Reply" }));
      await tabTo(
        page,
        page.getByRole("button", { name: "Previous Version" }).first(),
      );
      await page.keyboard.press("Enter");
      await expect(
        page.getByText("Explain streaming", { exact: true }),
      ).toBeVisible();
      await tabTo(page, page.getByRole("button", { name: "Choose model" }));
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("textbox", { name: "Search models" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("textbox", { name: "Search models" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Choose model" }),
      ).toBeFocused();
      // Errors must keep the draft and only payment/key errors offer the key action.
      for (const code of [
        "no_credits",
        "needs_byok_key",
        "payload_too_large",
        "unknown_error",
      ]) {
        injectedError = code;
        await composer.fill("Keep my draft");
        await composer.press("Enter");
        await expect(page.locator("main [role=alert]")).toBeVisible();
        await expect(composer).toHaveValue("Keep my draft");
        await expect(
          page.getByRole("button", {
            name: "Add your OpenRouter key",
            exact: true,
          }),
        ).toHaveCount(
          code === "no_credits" || code === "needs_byok_key" ? 1 : 0,
        );
        await page.screenshot({
          path: `docs/evidence/m4/${theme}-${width}-${code}.png`,
        });
      }
      injectedError = undefined;
      const current = await (
        await call(h, routes.getChatRoute, { user: "local", id: chat.id })
      ).json();
      await h.pg.query(
        "UPDATE message SET status = 'failed', parts = '[]', payment = 'credits' WHERE id = $1",
        [current.messages.at(-1).id],
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText(/You weren’t charged/)).toBeVisible();
      await page.screenshot({
        path: `docs/evidence/m4/${theme}-${width}-failed.png`,
      });
      // New-Chat handoff keeps both recovery records until acceptance.
      const fresh = await (
        await call(h, routes.createChatRoute, { user: "local", body: {} })
      ).json();
      await page.evaluate((id) => {
        localStorage.setItem("galaxy:draft:new", "First Message");
        sessionStorage.setItem(`galaxy:send:${id}`, "First Message");
      }, fresh.chat.id);
      injectedError = "no_credits";
      await page.goto(`http://localhost:3000/design/chat?id=${fresh.chat.id}`);
      await expect(page.locator("main [role=alert]")).toBeVisible();
      await expect(composer).toHaveValue("First Message");
      expect(
        await page.evaluate(
          (id) => [
            localStorage.getItem("galaxy:draft:new"),
            sessionStorage.getItem(`galaxy:send:${id}`),
          ],
          fresh.chat.id,
        ),
      ).toEqual(["First Message", "First Message"]);
      injectedError = undefined;
      await composer.press("Enter");
      await expect(composer).toHaveValue("");
      expect(
        await page.evaluate(
          (id) => [
            localStorage.getItem("galaxy:draft:new"),
            sessionStorage.getItem(`galaxy:send:${id}`),
          ],
          fresh.chat.id,
        ),
      ).toEqual([null, null]);
      await expect(
        page.getByRole("button", { name: "Send message" }),
      ).toBeVisible();
      await page.close();
      h.state.script = {
        words: (
          "A thoughtful Reply. " +
          "The Reply keeps streaming while you read. ".repeat(60)
        ).split(/(?<=\s)/),
        delayMs: 100,
      };
    }
  console.log(
    "PASS: streaming, refresh resume, Stop, Versions, Interrupted Continue, settled picker, empty/Failed/error states, draft handoff and keyboard-only flow; light/dark at 1280/390.",
  );
} finally {
  await browser.close();
  server.stop();
  await h.settle();
  await h.pg.close();
}
