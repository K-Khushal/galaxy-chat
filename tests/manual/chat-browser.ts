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
      await page.route("**/api/**", (route) =>
        route.continue({
          url: route.request().url().replace(":3000", ":3100"),
        }),
      );
      await page.addInitScript(
        (theme) => localStorage.setItem("theme", theme),
        theme,
      );
      await page.goto(`http://localhost:3000/design/chat?id=${chat.id}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await page
        .getByRole("textbox", { name: "Message", exact: true })
        .fill("Explain streaming");
      await page.addStyleTag({ content: "nextjs-portal {display:none}" });
      await page.getByRole("button", { name: "Send message" }).click();
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
      await page.getByRole("button", { name: "Choose model" }).click();
      await page.getByRole("textbox", { name: "Search models" }).fill("Claude");
      await expect(
        page.getByText("Add your OpenRouter key", { exact: true }).first(),
      ).toBeVisible();
      await page.screenshot({
        path: `docs/evidence/m4/${theme}-${width}-models.png`,
      });
      await page.keyboard.press("Escape");
      h.state.script = { words: ["A new Version."], delayMs: 100 };
      await page.getByRole("button", { name: "Regenerate Reply" }).click();
      await expect(page.getByText("2/2", { exact: true })).toBeVisible({
        timeout: 20000,
      });
      await page.getByRole("button", { name: "Edit Message" }).click();
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
      await page.addStyleTag({ content: "nextjs-portal {display:none}" });
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
    "PASS: streaming, refresh resume, Stop, regenerate and edit Versions, Interrupted Continue, locked picker; light/dark at 1280/390.",
  );
} finally {
  await browser.close();
  server.stop();
  await h.settle();
  await h.pg.close();
}
