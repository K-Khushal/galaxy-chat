import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message", exact: true });
async function send(page: Page, text: string) {
  // Hydration resets a value typed into the server-rendered textarea, so retry
  // until React owns it and enables Send.
  await expect(async () => {
    await composer(page).fill(text);
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeEnabled({ timeout: 1_000 });
  }).toPass();
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

async function reload(page: Page) {
  const ready = page.waitForResponse((response) =>
    response.url().endsWith("/api/credits"),
  );
  await page.reload();
  await ready;
}
async function openSidebar(page: Page) {
  if (
    (page.viewportSize()?.width ?? 1280) < 768 &&
    !(await page
      .getByRole("dialog", { name: "Sidebar", exact: true })
      .isVisible())
  ) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
    await expect(
      page.getByRole("dialog", { name: "Sidebar", exact: true }),
    ).toBeVisible();
  }
}

const violations = new WeakMap<Page, string[]>();
test("Reply rendering has no CSP violations", async ({ page, browserName }) => {
  test.fixme(
    browserName === "firefox",
    "BUG: Reply rendering attempts eval under nonce CSP in Firefox; components/elements/response.tsx:10 (Streamdown).",
  );
  await send(page, "Check CSP");
  await complete(page);
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
    if (
      url.hostname === "challenges.cloudflare.com" &&
      url.pathname.endsWith("api.js")
    ) {
      await route.fulfill({
        contentType: "application/javascript",
        body: 'window.turnstile = { render(element, options) { element.setAttribute("data-testid", "turnstile-placeholder"); element.textContent = "Turnstile test placeholder"; options.callback("e2e-token"); return "e2e"; }, reset() {} };',
      });
      return;
    }
    if (url.origin !== "http://127.0.0.1:34871") {
      throw new Error(`External browser request: ${url.origin}`);
    }
    await route.continue();
  });
  const response = await page.goto("/sign-in");
  expect(response?.headers()["content-security-policy"]).toContain("nonce-");
  expect(response?.headers()["content-security-policy"]).not.toContain(
    "unsafe-eval",
  );
  const ready = page.waitForResponse((response) =>
    response.url().endsWith("/api/credits"),
  );
  await page.getByRole("button", { name: "E2E sign in" }).click();
  await ready;
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await expect(
    page.getByText("10 Credits left", { exact: true }),
  ).toBeVisible();
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await page.keyboard.press("Escape");
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
  await reload(page);
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
  await reload(page);
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
  await reload(page);
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
  await openSidebar(page);
  await page.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Chat title" }).fill("Renamed Chat");
  await page.getByRole("textbox", { name: "Chat title" }).press("Enter");
  await openSidebar(page);
  await page.getByRole("button", { name: "Actions for Renamed Chat" }).click();
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pinned", exact: true }),
  ).toBeVisible();
  await reload(page);
  await openSidebar(page);
  await expect(
    page.getByRole("link", { name: "Renamed Chat", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Meta+k");
  await page.getByRole("combobox").fill("uniquely searchable astronomy");
  await page.getByRole("option").filter({ hasText: "Renamed Chat" }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/${id}$`));
  await openSidebar(page);
  await page.getByRole("button", { name: "Actions for Renamed Chat" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete Chat", exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  expect((await page.request.get(`/api/chats/${id}`)).status()).toBe(404);
});

test("Temporary chat streams without saving anything", async ({ page }) => {
  const before = await (await page.request.get("/api/account/export")).json();
  const ready = page.waitForResponse((response) =>
    response.url().endsWith("/api/credits"),
  );
  await page.goto("/chat/temporary");
  await ready;
  await send(page, "Temporary Message");
  await expect(
    page.getByRole("log", { name: "Temporary Messages" }),
  ).toContainText("A thoughtful Reply. Complete.");
  await reload(page);
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
  await reload(page);
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
  await page
    .locator('input[type="file"]')
    .last()
    .setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("offline attachment text"),
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
  await reload(page);
  await expect(page.getByRole("img", { name: "star.png" })).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "star.png" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: "notes.txt" })).toBeVisible();
  await openSidebar(page);
  await page.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete Chat", exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  expect((await page.request.get(`/api/chats/${id}`)).status()).toBe(404);
  for (const url of urls)
    expect((await page.request.head(url)).status()).toBe(404);
});

test("Settings BYOK lifecycle, export and persistent themes", async ({
  page,
}) => {
  await page.goto("/chat/settings");
  await page.getByRole("button", { name: "Add key", exact: true }).click();
  await page
    .getByLabel("OpenRouter key", { exact: true })
    .fill("e2e-byok-key-00000000000000000000000000000000");
  await page.getByRole("button", { name: "Save key" }).click();
  await page.getByRole("button", { name: "Test key", exact: true }).click();
  await expect(
    page.getByText("Your key works.", { exact: true }),
  ).toBeVisible();
  await reload(page);
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  await expect(
    page.getByText("No OpenRouter key saved.", { exact: true }),
  ).toBeVisible();
  for (const theme of ["Light", "Dark", "System"]) {
    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitemradio", { name: theme, exact: true }).click();
    await reload(page);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("theme")))
      .toBe(theme.toLowerCase());
  }
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export account as JSON" }).click();
  expect((await download).suggestedFilename()).toMatch(/json$/);
});

test("model picker keyboard search and focus restoration", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Choose model" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("textbox", { name: "Search models" })
    .fill("no-such-model");
  await expect(
    page.getByText("No models found.", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await composer(page).focus();
  await page.keyboard.type("Keyboard Message");
  await page.keyboard.press("Enter");
  await complete(page);
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await expect(page.getByText("9 Credits left", { exact: true })).toBeVisible();
});

for (const [code, status, copy] of [
  ["rate_limited", 429, "Too many messages. Wait a minute and try again."],
  [
    "payload_too_large",
    413,
    "This Message is too long. Shorten it and try again.",
  ],
  ["unexpected", 500, "Something went wrong. Please try again."],
] as const) {
  test(`Message error: ${code}`, async ({ page }) => {
    await send(page, "Initial Message");
    await complete(page);
    await page.route("**/api/chats/*/messages", (route) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ error: code }),
      }),
    );
    await send(page, "Rejected Message");
    await expect(page.getByText(copy, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop Reply" })).toHaveCount(
      0,
    );
  });
}

test("attachment removal and size/type rejection", async ({ page }) => {
  const input = page.locator('input[type="file"]').last();
  await input.setInputFiles({
    name: "draft.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("discard this"),
  });
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove draft.txt" }).click();
  await expect(
    page.getByRole("button", { name: "Remove draft.txt" }),
  ).toHaveCount(0);
  await input.setInputFiles({
    name: "large.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(page.getByText(/large.txt.*larger than 10 MB/)).toBeVisible();
  await input.setInputFiles({
    name: "program.exe",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.getByText(/program.exe.*can’t be attached/)).toBeVisible();
});

test("basic accessibility in Chat and Settings", async ({ page }) => {
  for (const path of ["/chat", "/chat/settings"]) {
    await page.goto(path);
    await expect(
      page
        .getByRole("button", { name: "Choose model" })
        .or(page.getByLabel("About you", { exact: true })),
    ).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  }
});

test("Interrupted Reply keeps partial text after reload", async ({ page }) => {
  await send(page, "[interrupted] Keep the checkpoint");
  await expect(page.getByText("Interrupted", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await reload(page);
  await expect(page.getByText("Interrupted", { exact: true })).toBeVisible();
  expect((await view(page)).messages.at(-1).status).toBe("interrupted");
});

test("Markdown and code copy control render", async ({ page }) => {
  await send(page, "[rich] Render rich text");
  await complete(page);
  const reply = page.getByRole("article", { name: "Reply", exact: true });
  await expect(reply.getByRole("heading", { name: "Astronomy" })).toBeVisible();
  await expect(reply.locator('[data-streamdown="strong"]')).toHaveText("Stars");
  await expect(reply.locator("pre")).toContainText("const stars = 3;");
  await expect(
    reply.getByRole("button", { name: /copy/i }).first(),
  ).toBeVisible();
});

test("signed-out Chat redirects to sign-in", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("button", { name: "E2E sign in" })).toBeVisible();
});

test("PDF Attachment uploads, reaches the mock and persists", async ({
  page,
}) => {
  // Minimal valid PDF with a real xref, kept inline to avoid binary fixtures.
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const text = "BT /F1 12 Tf 20 200 Td (offline PDF astronomy) Tj ET";
  objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await page
    .locator('input[type="file"]')
    .last()
    .setInputFiles({
      name: "astronomy.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(pdf),
    });
  await expect(
    page.getByRole("button", { name: "Remove astronomy.pdf" }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await send(page, "[pdf] Read the PDF");
  await complete(page);
  expect(
    (await view(page)).messages[0].parts.some(
      (part: { type: string }) => part.type === "file",
    ),
  ).toBe(true);
  await reload(page);
  await expect(page.getByRole("link", { name: "astronomy.pdf" })).toBeVisible();
});

test("sign-in methods and email-code UI through the offline seam", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto("/sign-in");
  await expect(
    page.getByRole("button", { name: "Continue with GitHub" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(page.getByTestId("turnstile-placeholder")).toBeVisible();
  await page.route("**/api/auth/email-otp/send-verification-otp", (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.route("**/api/auth/sign-in/email-otp", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      email: "offline@example.com",
      otp: "123456",
    });
    const response = await page.request.post("/api/test-e2e/sign-in", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    await route.fulfill({ json: { user: { email: "offline@example.com" } } });
  });
  await page.getByLabel("Email", { exact: true }).fill("offline@example.com");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeDisabled();
  await page.getByLabel("Six-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  expect((await (await page.request.get("/api/credits")).json()).credits).toBe(
    10,
  );
});

test("account menu sign-out returns to sign-in", async ({ page, context }) => {
  // Better Auth does not own the opaque E2E cookie. Mirror its cookie removal
  // in the browser seam while exercising the actual account menu and redirect.
  await page.route("**/api/auth/sign-out", async (route) => {
    await context.clearCookies();
    await route.fulfill({ json: { success: true } });
  });
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await page.getByRole("button", { name: /E2E User/ }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("KaTeX math retains its rendering markup", async ({ page }) => {
  test.fixme(
    true,
    "BUG: math output loses KaTeX classes/MathML and shows duplicated text; components/elements/response.tsx:10 (Streamdown sanitization).",
  );
  await send(page, "[rich] Render math");
  await complete(page);
  await expect(
    page
      .getByRole("article", { name: "Reply", exact: true })
      .locator(".katex")
      .first(),
  ).toBeVisible();
});
