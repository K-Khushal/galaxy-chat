import { expect, type Page, test } from "@playwright/test";

const TITLES = [
  "Settings",
  "General",
  "Personalization",
  "OpenRouter key",
  "Usage",
  "Archived chats",
  "Account",
];

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "E2E sign in" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
}

/** Top of the page title and every group title, in the order they are on screen. */
async function titleTops(page: Page) {
  const tops: Record<string, number> = {};
  for (const name of TITLES) {
    const box = await page
      .locator("h1, h2")
      .filter({ hasText: new RegExp(`^${name}$`) })
      .boundingBox();
    if (!box) throw new Error(`"${name}" is not visible`);
    tops[name] = Math.round(box.y * 10) / 10;
  }
  return tops;
}

/**
 * Holds the Settings navigation open so the route's skeleton can be measured.
 * The prefetch, which carries the skeleton, goes through; the navigation waits.
 */
async function measure(page: Page) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const isSettings = (url: URL) => url.pathname === "/chat/settings";
  let started = 0;
  let finished = 0;
  await page.route(isSettings, async (route) => {
    if (route.request().headers()["next-router-prefetch"]) {
      started++;
      // Buffer the whole prefetch, so the router has the skeleton before the
      // navigation starts.
      await route.fulfill({ response: await route.fetch() });
      finished++;
      return;
    }
    await gate;
    await route.continue();
  });
  const compact = (page.viewportSize()?.width ?? 1280) < 768;
  const settings = page.getByRole("menuitem", { name: "Settings" });
  // Retry until hydration lets the drawer and the account menu open. Once the
  // link is clicked the navigation is in flight, so it is never clicked twice.
  await expect(async () => {
    if (
      compact &&
      !(await page.getByRole("dialog", { name: "Sidebar" }).isVisible())
    )
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    if (!(await settings.isVisible()))
      await page
        .getByRole("button", { name: /E2E User/ })
        .click({ timeout: 2_000 });
    await expect(settings).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await expect.poll(() => started > 0 && started === finished).toBe(true);
  // Let the router store what it was sent.
  await page.waitForTimeout(250);
  await settings.click();
  await expect(
    page
      .locator("section", { hasText: /^Personalization/ })
      .locator('[data-slot="skeleton"]')
      .first(),
  ).toBeVisible({ timeout: 15_000 });
  // The skeleton fades in after 160ms; geometry is the same before and after.
  const skeleton = await titleTops(page);
  release();
  await expect(page).toHaveURL(/\/chat\/settings$/);
  // On phones the drawer can still be open over the page, which hides it from
  // role queries.
  const drawer = page.getByRole("dialog", { name: "Sidebar", exact: true });
  if (await drawer.isVisible()) await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "About you" })).toBeVisible();
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  const content = await titleTops(page);
  console.log(
    `${page.viewportSize()?.width}px`,
    JSON.stringify({ skeleton, content }),
  );
  expect(content).toEqual(skeleton);
}

for (const { width, touch } of [
  { width: 390, touch: true },
  { width: 820, touch: true },
  { width: 1440, touch: false },
]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: touch });

    test("an empty account moves no titles when Settings loads", async ({
      page,
    }) => {
      await signIn(page);
      await measure(page);
    });

    test("an account with a key, Replies and archived Chats moves no titles", async ({
      page,
    }) => {
      await signIn(page);
      const composer = page.getByRole("textbox", {
        name: "Message",
        exact: true,
      });
      await expect(async () => {
        await composer.fill("Fill the Usage table");
        await expect(
          page.getByRole("button", { name: "Send message" }),
        ).toBeEnabled({ timeout: 1_000 });
      }).toPass();
      await composer.press("Enter");
      await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
      await expect(
        page.getByRole("button", { name: "Regenerate Reply" }).last(),
      ).toBeEnabled();
      const id = page.url().split("/").at(-1);
      const origin = { origin: "http://127.0.0.1:34871" };
      expect(
        (
          await page.request.patch(`/api/chats/${id}`, {
            data: { archived: true },
            headers: origin,
          })
        ).ok(),
      ).toBe(true);
      expect(
        (
          await page.request.put("/api/byok", {
            data: { key: "e2e-byok-key-00000000000000000000000000000000" },
            headers: origin,
          })
        ).ok(),
      ).toBe(true);
      await page.goto("/chat");
      await expect(composer).toBeVisible();
      await measure(page);
    });
  });
}
