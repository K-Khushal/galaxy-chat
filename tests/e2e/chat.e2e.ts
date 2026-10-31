import { expect, type Page, test } from "@playwright/test";

const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message", exact: true });
async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}
async function complete(page: Page) {
  await expect(
    page.getByRole("button", { name: "Regenerate Reply" }).last(),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "Stop Reply" })).toHaveCount(0);
}
async function view(page: Page) {
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  return (
    await page.request.get(`/api/chats/${page.url().split("/").at(-1)}`)
  ).json();
}

const violations = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => {
  expect(violations.get(page)).toEqual([]);
});
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  violations.set(page, errors);
  page.on("console", (message) => {
    if (/content security policy|violates.*directive/i.test(message.text()))
      errors.push(message.text());
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3008") {
      throw new Error(`External browser request: ${url.origin}`);
    }
    await route.continue();
  });
  const response = await page.goto("/sign-in");
  expect(response?.headers()["content-security-policy"]).toContain("nonce-");
  expect(response?.headers()["content-security-policy"]).not.toContain(
    "unsafe-eval",
  );
  await page.getByRole("button", { name: "E2E sign in" }).click();
  await expect(
    page.getByText("10 Credits left", { exact: true }),
  ).toBeVisible();
});

test("sign in grants 10 Credits and lands on /chat", async ({ page }) => {
  await expect(page).toHaveURL(/\/chat$/);
  expect((await (await page.request.get("/api/credits")).json()).credits).toBe(
    10,
  );
});

test("send streams and persists the Reply after reload", async ({ page }) => {
  await send(page, "Persist this Message");
  await complete(page);
  const saved = await view(page);
  expect(saved.messages).toHaveLength(2);
  await page.reload();
  await expect(
    page.getByText("Persist this Message", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("A thoughtful Reply. Complete.", { exact: true }),
  ).toBeVisible();
  expect((await view(page)).messages).toEqual(saved.messages);
});

test("Stop preserves a partial Stopped Reply", async ({ page }) => {
  await send(page, "[slow] Stop this");
  await expect(page.getByText(/A thoughtful Reply/).first()).toBeVisible();
  await page.getByRole("button", { name: "Stop Reply" }).click();
  await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
  const saved = (await view(page)).messages.at(-1);
  expect(saved.status).toBe("stopped");
  expect(JSON.stringify(saved.parts)).toContain("A thoughtful Reply");
  expect(JSON.stringify(saved.parts)).not.toContain("Complete.");
});

test("reload resumes and completes the same Reply", async ({ page }) => {
  await send(page, "[slow] Resume this");
  await expect(page.getByText(/A thoughtful Reply/).first()).toBeVisible();
  const before = await view(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "Stop Reply" })).toBeVisible();
  await complete(page);
  const after = await view(page);
  expect(after.messages.map((m: { id: string }) => m.id)).toEqual(
    before.messages.map((m: { id: string }) => m.id),
  );
  expect(after.messages.at(-1).status).toBe("complete");
  await expect(page.getByText(/Complete\./).first()).toBeVisible();
});

test("edit and regenerate create switchable Versions", async ({ page }) => {
  await send(page, "Original Message");
  await complete(page);
  await page.getByRole("button", { name: "Regenerate Reply" }).click();
  await expect(page.getByText("2/2", { exact: true })).toBeVisible();
  await complete(page);
  await page.getByRole("button", { name: "Previous Version" }).click();
  await expect(page.getByText("1/2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next Version" }).click();
  await expect(page.getByText("2/2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Message", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit Message", exact: true })
    .fill("Edited Message");
  await page.getByRole("button", { name: "Save and send" }).click();
  await complete(page);
  await expect(page.getByText("Edited Message", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous Version" }).first().click();
  await expect(
    page.getByText("Original Message", { exact: true }),
  ).toBeVisible();
});

test("spend Credits, see no_credits, then send with a BYOK key", async ({
  page,
}) => {
  for (let i = 0; i < 10; i++) {
    await send(page, `Message ${i}`);
    await expect
      .poll(async () => (await view(page)).messages.length)
      .toBe((i + 1) * 2);
    await expect(page.getByRole("button", { name: "Stop Reply" })).toHaveCount(
      0,
    );
  }
  expect((await (await page.request.get("/api/credits")).json()).credits).toBe(
    0,
  );
  const rejected = page.waitForResponse(
    (r) => r.url().endsWith("/messages") && r.status() === 402,
  );
  await send(page, "Needs a key");
  expect(await (await rejected).json()).toMatchObject({ error: "no_credits" });
  await page
    .getByRole("button", { name: "Add your OpenRouter key", exact: true })
    .click();
  await page
    .getByLabel("OpenRouter key", { exact: true })
    .fill("e2e-byok-key-00000000000000000000000000000000");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await composer(page).press("Enter");
  await expect.poll(async () => (await view(page)).messages.length).toBe(22);
  await expect(page.getByRole("button", { name: "Stop Reply" })).toHaveCount(0);
  expect((await view(page)).messages.at(-1).payment).toBe("byok");
});

test("sidebar rename, pin, message search with Command K, and delete", async ({
  page,
}) => {
  await send(page, "uniquely searchable astronomy");
  await complete(page);
  const id = page.url().split("/").at(-1);
  await page.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Chat title" }).fill("Renamed Chat");
  await page.getByRole("textbox", { name: "Chat title" }).press("Enter");
  await page.getByRole("button", { name: "Actions for Renamed Chat" }).click();
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pinned", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Renamed Chat", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Meta+k");
  await page.getByRole("combobox").fill("uniquely searchable astronomy");
  await page.getByRole("option").filter({ hasText: "Renamed Chat" }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/${id}$`));
  await page.getByRole("button", { name: "Actions for Renamed Chat" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete Chat", exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  expect((await page.request.get(`/api/chats/${id}`)).status()).toBe(404);
});

test("Temporary chat streams without saving anything", async ({ page }) => {
  const before = await (await page.request.get("/api/account/export")).json();
  await page.goto("/chat/temporary");
  await send(page, "Temporary Message");
  await expect(
    page.getByRole("log", { name: "Temporary Messages" }),
  ).toContainText("A thoughtful Reply. Complete.");
  await page.reload();
  await expect(
    page.getByRole("log", { name: "Temporary Messages" }),
  ).not.toContainText("Temporary Message");
  const after = await (await page.request.get("/api/account/export")).json();
  expect(after.chats).toEqual(before.chats);
  expect(after.messages).toEqual(before.messages);
});

test("save Custom instructions and delete account", async ({ page }) => {
  await page.goto("/chat/settings");
  await page
    .getByLabel("About you", { exact: true })
    .fill("I study astronomy.");
  await page.getByLabel("How should Galaxy respond").fill("Be concise.");
  await page.getByRole("button", { name: "Save instructions" }).click();
  await expect(
    page.getByText("Custom instructions saved.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("About you", { exact: true })).toHaveValue(
    "I study astronomy.",
  );
  await expect(page.getByLabel("How should Galaxy respond")).toHaveValue(
    "Be concise.",
  );
  await page.getByLabel(/Type DELETE/).fill("DELETE");
  await page
    .getByRole("button", { name: "Delete account permanently", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in/);
  expect((await page.request.get("/api/settings")).status()).toBe(401);
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("attachments upload offline, reach the mock, persist and delete with the Chat", async ({
  page,
}) => {
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=",
    "base64",
  );
  let putUrl = "";
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/test-e2e/storage?*", async (route) => {
    if (route.request().method() === "PUT") {
      putUrl = route.request().url();
      await held;
    }
    await route.continue();
  });
  const uploaded = page.waitForResponse(
    (r) =>
      r.url().includes("/api/attachments") && r.request().method() === "POST",
  );
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "star.png", mimeType: "image/png", buffer: image });
  await uploaded;
  await expect(
    page.getByRole("progressbar", { name: "Uploading star.png" }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("progressbar", { name: "Uploading star.png" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Remove star.png" }),
  ).toBeVisible();
  await composer(page).evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["offline attachment text"], "notes.txt", {
        type: "text/plain",
      }),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }),
    );
  });
  await expect(
    page.getByRole("button", { name: "Remove notes.txt" }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await send(page, "[attachments] Read these files");
  await complete(page);
  await expect(
    page
      .getByRole("article", { name: "Reply", exact: true })
      .getByText("A thoughtful Reply. Complete.", { exact: true }),
  ).toBeVisible();
  const saved = await view(page);
  expect(
    (
      await page.request.put(putUrl, {
        data: "offline attachment text",
        headers: { "Content-Type": "text/plain" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.put(putUrl, {
        data: "offline attachment text",
        headers: { "Content-Type": "text/plain", "If-None-Match": "*" },
      })
    ).status(),
  ).toBe(412);
  const id = page.url().split("/").at(-1);
  const urls: string[] = [];
  for (const part of saved.messages[0].parts.filter(
    (part: { type: string }) => part.type === "file",
  )) {
    const response = await page.request.get(part.url, { maxRedirects: 0 });
    const url = response.headers().location;
    urls.push(url);
    expect((await page.request.head(url)).status()).toBe(200);
    const range = await page.request.get(url, {
      headers: { Range: "bytes=0-3" },
    });
    expect(range.status()).toBe(206);
    expect((await range.body()).length).toBe(4);
  }
  expect(urls).toHaveLength(2);
  await page.reload();
  await expect(page.getByRole("img", { name: "star.png" })).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "star.png" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "notes.txt" })).toBeVisible();
  await page.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete Chat", exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  expect((await page.request.get(`/api/chats/${id}`)).status()).toBe(404);
  for (const url of urls)
    expect((await page.request.head(url)).status()).toBe(404);
});
