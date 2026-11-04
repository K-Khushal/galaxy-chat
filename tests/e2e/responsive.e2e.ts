import { expect, type Page, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "phone 360x740", width: 360, height: 740, touch: true },
  { name: "phone 390x844", width: 390, height: 844, touch: true },
  { name: "tablet portrait 768x1024", width: 768, height: 1024, touch: true },
  { name: "tablet landscape 1024x768", width: 1024, height: 768, touch: true },
  { name: "laptop 1280x800", width: 1280, height: 800, touch: false },
  { name: "wide 1920x1080", width: 1920, height: 1080, touch: false },
];

const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message", exact: true });

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "E2E sign in" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(composer(page)).toBeVisible();
}

/** Nothing may push the page wider than the screen, even where `html` hides the overflow. */
async function expectFitsWidth(page: Page) {
  const problems = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const found: string[] = [];
    if (document.documentElement.scrollWidth > width)
      found.push(
        `document scrollWidth ${document.documentElement.scrollWidth}`,
      );
    const clipped = (element: Element) => {
      for (
        let parent = element.parentElement;
        parent && parent !== document.body;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (style.position === "fixed") return true;
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) return true;
      }
      return false;
    };
    for (const element of document.body.querySelectorAll("*")) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (getComputedStyle(element).position === "fixed") continue;
      if (box.right > width + 1 && !clipped(element))
        found.push(
          `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)} right=${Math.round(box.right)}`,
        );
    }
    return found.slice(0, 5);
  });
  expect(problems).toEqual([]);
}

async function expectInsideViewport(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  const size = page.viewportSize();
  if (!box || !size) throw new Error(`${selector} is not visible`);
  expect(box.x).toBeGreaterThanOrEqual(-0.5);
  expect(box.y).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height + 0.5);
}

for (const viewport of VIEWPORTS) {
  const compact = viewport.width < 768;
  test.describe(viewport.name, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.touch,
    });

    test("public pages have no horizontal scroll", async ({ page }) => {
      for (const path of ["/privacy", "/terms"]) {
        await page.goto(path);
        await expectFitsWidth(page);
      }
    });

    test("chat pages have no horizontal scroll", async ({ page }) => {
      await signIn(page);
      for (const path of ["/chat", "/chat/settings", "/chat/temporary"]) {
        await page.goto(path);
        await expect(page.locator("h1").first()).toBeAttached();
        await expectFitsWidth(page);
      }
    });

    test("sidebar is a drawer on phones and a panel above that", async ({
      page,
    }) => {
      await signIn(page);
      const newChat = page.getByRole("link", { name: "New chat" });
      if (compact) {
        await expect(newChat).toBeHidden();
        await openDrawer(page);
        await expect(newChat).toBeVisible();
        await expectInsideViewport(page, '[data-slot="sidebar"][data-mobile]');
        await page.keyboard.press("Escape");
        await expect(newChat).toBeHidden();
      } else {
        await expect(newChat).toBeVisible();
      }
    });

    test("a wide Reply scrolls inside its own box", async ({ page }) => {
      await signIn(page);
      // Wait for hydration to own the textarea before submitting.
      await expect(async () => {
        await composer(page).fill("[markdown] show wide content");
        await expect(
          page.getByRole("button", { name: "Send message" }),
        ).toBeEnabled({ timeout: 1_000 });
      }).toPass();
      await composer(page).press("Enter");
      await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
      await expect(
        page.getByRole("button", { name: "Regenerate Reply" }).last(),
      ).toBeEnabled();
      await expect(page.locator("pre").first()).toBeVisible();
      await expectFitsWidth(page);
      const scrolls = await page.evaluate(() => {
        const code = [...document.querySelectorAll("pre, code")].find((node) =>
          node.textContent?.includes("xxxxxxxxxx"),
        );
        for (
          let node: Element | null = code ?? null;
          node;
          node = node.parentElement
        ) {
          if (/(auto|scroll)/.test(getComputedStyle(node).overflowX))
            return {
              overflowing: node.scrollWidth > node.clientWidth,
              fits: node.getBoundingClientRect().right <= innerWidth + 1,
            };
        }
        return null;
      });
      expect(scrolls).toEqual({
        overflowing: true,
        fits: true,
      });
    });

    test("dialogs fit the screen", async ({ page }) => {
      await signIn(page);
      // A click before hydration does nothing, so retry until the popover opens.
      await expect(async () => {
        if (!(await page.getByRole("dialog").isVisible()))
          await page.getByRole("button", { name: "Choose model" }).click();
        await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
      }).toPass();
      await expectInsideViewport(page, '[data-slot="popover-content"]');
      await page.keyboard.press("Escape");
      if (compact) await openDrawer(page);
      await page.getByRole("button", { name: "Search" }).click();
      await expect(page.getByRole("combobox")).toBeVisible();
      await expectInsideViewport(page, '[data-slot="dialog-content"]');
    });

    if (viewport.touch)
      test("touch targets are at least 44px", async ({ page }) => {
        await signIn(page);
        const small = await smallTargets(page);
        expect(small).toEqual([]);
        if (compact) {
          await openDrawer(page);
          await expect(
            page.getByRole("link", { name: "New chat" }),
          ).toBeVisible();
          expect(await smallTargets(page)).toEqual([]);
        }
      });
  });
}

/** Opens the sidebar drawer, retrying until hydration lets the toggle work. */
async function openDrawer(page: Page) {
  await expect(async () => {
    if (!(await page.getByRole("dialog").isVisible()))
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(page.getByRole("link", { name: "New chat" })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass();
}

/** Visible controls whose tap area is under 44px; links inside running text are exempt. */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const found: string[] = [];
    const selector =
      "button, a[href], input:not([type=hidden]):not([type=file]), textarea, [role=menuitem], [role=tab], [role=switch]";
    for (const element of document.querySelectorAll(selector)) {
      if (element.closest("p, li > p, [aria-hidden=true]")) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (
        box.right < 0 ||
        box.left > innerWidth ||
        box.bottom < 0 ||
        box.top > innerHeight
      )
        continue;
      if (box.width < 43.5 || box.height < 43.5)
        found.push(
          `${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30)}" ${Math.round(box.width)}x${Math.round(box.height)}`,
        );
    }
    return found;
  });
}
