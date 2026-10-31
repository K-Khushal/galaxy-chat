// Run with: bun tests/manual/attachments-browser.ts (next dev must be on :3000).
// Like chat-browser.ts, this drives the real UI against an isolated local
// harness (PGlite, in-memory Redis and storage, AI SDK mock model) on :3100.
// The harness's storage hands out URLs on :3100 and answers CORS preflight
// the way a configured R2 bucket does, so the browser performs a real
// cross-origin PUT with progress. No provider or R2 call is made.
import { mock } from "bun:test";
import { deflateSync } from "node:zlib";

mock.module("server-only", () => ({}));
const { createHarness, call } = await import("../support/harness");
const { pdf } = await import("../support/files");
const chats = await import("../../lib/api/chats");
const attachments = await import("../../lib/api/attachments");
const byok = await import("../../lib/api/byok");
const { chromium, expect: baseExpect } = await import("@playwright/test");
const expect = baseExpect.configure({ timeout: 30000 });

const ORIGIN = "http://localhost:3100";
const h = await createHarness();
await h.addUser("local", 100);
const storage = h.storage;
storage.presignPut = async (key, options) => {
  storage.puts.push({ key, ...options });
  return `${ORIGIN}/__put/${key}?len=${options.contentLength}`;
};
storage.presignGet = async (key, options) => {
  const url = `${ORIGIN}/__get/${key}`;
  storage.gets.push({ key, url, disposition: options.disposition });
  return url;
};
h.state.script = {
  words:
    "I can see the attached image, a blue-to-pink gradient, and I have read the PDF: its page says the quarterly revenue grew 12 percent.".split(
      /(?<=\s)/,
    ),
  delayMs: 40,
};

const cors = {
  "access-control-allow-origin": "http://localhost:3000",
  "access-control-allow-methods": "PUT",
  "access-control-allow-headers": "content-type, if-none-match",
};
/** Slows the PUT so the progress bar can be seen. */
let putDelayMs = 0;
const server = Bun.serve({
  port: 3100,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/__put/")) {
      if (req.method === "OPTIONS")
        return new Response(null, { headers: cors });
      const key = url.pathname.slice("/__put/".length);
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length !== Number(url.searchParams.get("len"))) {
        return new Response("length mismatch", { status: 403, headers: cors });
      }
      await Bun.sleep(putDelayMs);
      if (req.headers.get("if-none-match") !== "*")
        return new Response(null, { status: 403, headers: cors });
      if (storage.objects.has(key))
        return new Response(null, { status: 412, headers: cors });
      storage.upload(key, bytes, req.headers.get("content-type") ?? "");
      return new Response(null, { status: 200, headers: cors });
    }
    if (url.pathname.startsWith("/__get/")) {
      const stored = storage.objects.get(url.pathname.slice("/__get/".length));
      return stored
        ? new Response(Buffer.from(stored.bytes), {
            headers: { "content-type": stored.contentType },
          })
        : new Response(null, { status: 404 });
    }
    if (!url.pathname.startsWith("/api/"))
      return new Response(null, { status: 404 });
    const [, , kind, id, action] = url.pathname.split("/");
    const handler =
      kind === "byok"
        ? byok.getByokRoute
        : kind === "attachments"
          ? action === "confirm"
            ? attachments.confirmRoute
            : id
              ? req.method === "DELETE"
                ? attachments.deleteAttachmentRoute
                : attachments.viewRoute
              : attachments.presignRoute
          : !id
            ? req.method === "POST"
              ? chats.createChatRoute
              : chats.listChatsRoute
            : action === "messages"
              ? chats.sendMessageRoute
              : action === "stream"
                ? chats.resumeStreamRoute
                : action === "stop"
                  ? chats.stopRoute
                  : action === "version"
                    ? chats.switchVersionRoute
                    : chats.getChatRoute;
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

/** A 360x220 blue-to-pink gradient PNG. */
function gradientPng(): Uint8Array {
  const [width, height] = [360, 220];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = Math.round((x / width) * 220 + 30);
      raw[row + 2 + x * 3] = Math.round((y / height) * 90 + 60);
      raw[row + 3 + x * 3] = Math.round(255 - (x / width) * 90);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(
      Bun.hash.crc32(out.subarray(4, 8 + data.length)),
      8 + data.length,
    );
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const png = gradientPng();
const report = pdf("Quarterly revenue grew 12 percent");
const browser = await chromium.launch({ headless: true });
try {
  for (const [theme, width] of [
    ["light", 1280],
    ["dark", 390],
  ] as const) {
    const created = await call(h, chats.createChatRoute, {
      user: "local",
      body: {},
    });
    const { chat } = (await created.json()) as { chat: { id: string } };
    console.log("case", theme, width);
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      colorScheme: theme,
      hasTouch: width === 390,
    });
    page.on("pageerror", (error) => console.log("pageerror", error.message));
    await page.route("**/api/**", (route) =>
      route.continue({ url: route.request().url().replace(":3000", ":3100") }),
    );
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await page.goto(`http://localhost:3000/design/chat?id=${chat.id}`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.addStyleTag({ content: "nextjs-portal {display:none}" });
    const composer = page.getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    await expect(composer).toBeVisible();
    const prefix = `docs/evidence/m6/${theme}-${width}`;

    // The "+" menu, with both actions.
    await page.getByRole("button", { name: "Add attachment" }).click();
    await expect(
      page.getByRole("menuitem", { name: /Add photos/ }),
    ).toBeVisible();
    await page.waitForTimeout(400);
    if (width === 1280) await page.screenshot({ path: `${prefix}-menu.png` });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("menuitem", { name: /Add photos/ }),
    ).toHaveCount(0);

    // Pick an image and a PDF; the PUT is slowed so progress is visible.
    putDelayMs = 1500;
    const inputs = page.locator('input[type="file"]');
    await inputs.nth(0).setInputFiles({
      name: "gradient.png",
      mimeType: "image/png",
      buffer: Buffer.from(png),
    });
    await inputs.nth(1).setInputFiles({
      name: "report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(report),
    });
    await expect(
      page.getByRole("progressbar", { name: "Uploading report.pdf" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeDisabled();
    if (width === 1280)
      await page.screenshot({ path: `${prefix}-uploading.png` });
    putDelayMs = 0;
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await composer.fill("What do the image and the PDF show?");
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeEnabled();

    // Send: the Message shows the files and the model reads them.
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("revenue grew 12 percent", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeVisible({ timeout: 20000 });
    const prompt = h.state.calls.filter((c) => c.prompt).at(-1)?.prompt ?? "";
    const reads = [...prompt.matchAll(/__get\/u\/local\//g)].length;
    if (
      reads !== 2 ||
      !prompt.includes("application/pdf") ||
      !prompt.includes("image/png")
    ) {
      throw new Error(
        `model did not receive both files: ${prompt.slice(0, 400)}`,
      );
    }
    console.log("model received the image and the PDF as read URLs");
    await expect(page.getByRole("img", { name: "gradient.png" })).toBeVisible();
    await expect(page.getByRole("link", { name: "report.pdf" })).toBeVisible();
    await page.screenshot({ path: `${prefix}-sent.png` });

    // Thumbnail opens larger; Escape closes it.
    await page.getByRole("button", { name: "Open gradient.png" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(300);
    if (width === 1280) await page.screenshot({ path: `${prefix}-larger.png` });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // A refresh keeps the files on the saved Message.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("img", { name: "gradient.png" })).toBeVisible();

    // Limits and paste, in the real browser.
    await page.addStyleTag({ content: "nextjs-portal {display:none}" });
    await inputs.nth(1).setInputFiles({
      name: "huge.txt",
      mimeType: "text/plain",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 65),
    });
    await expect(
      page.getByRole("form", { name: "Message Galaxy" }).getByRole("alert"),
    ).toContainText("larger than 10 MB");
    await inputs.nth(1).setInputFiles({
      name: "malware.exe",
      mimeType: "application/x-msdownload",
      buffer: Buffer.from("MZ"),
    });
    await expect(
      page.getByRole("form", { name: "Message Galaxy" }).getByRole("alert"),
    ).toContainText("can’t be attached");
    await page.evaluate(async () => {
      const textarea = document.querySelector(
        "textarea",
      ) as HTMLTextAreaElement;
      const data = new DataTransfer();
      data.items.add(new File(["const a = 1;\n"], "pasted.ts", { type: "" }));
      textarea.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(page.getByText("pasted.ts")).toBeVisible();
    await page.getByRole("button", { name: "Remove pasted.ts" }).click();

    // Deleting the Chat deletes its objects.
    const before = storage.objects.size;
    const removed = await call(h, chats.deleteChatRoute, {
      user: "local",
      id: chat.id,
      method: "DELETE",
    });
    console.log(
      "delete chat",
      removed.status,
      "objects",
      before,
      "->",
      storage.objects.size,
    );
    if (removed.status !== 204 || storage.objects.size !== 0)
      throw new Error("chat files were not deleted");
    await page.close();
  }
  console.log("attachments browser run passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.stop(true);
  process.exit(process.exitCode ?? 0);
}
