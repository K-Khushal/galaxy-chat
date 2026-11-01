import { expect, test } from "@playwright/test";

const meta = (name: string) => `meta[name="${name}"], meta[property="${name}"]`;

test("robots.txt and sitemap.xml describe the public pages only", async ({
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  for (const line of [
    "User-Agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /chat",
    "Disallow: /settings",
    "Sitemap: https://galaxychat.tech/sitemap.xml",
  ])
    expect(robots).toContain(line);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(
    [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
  ).toEqual([
    "https://galaxychat.tech",
    "https://galaxychat.tech/privacy",
    "https://galaxychat.tech/terms",
  ]);
});

test("manifest and generated images are served", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "Galaxy Chat", start_url: "/" });
  for (const path of ["/opengraph-image", "/twitter-image", "/apple-icon"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toBe("image/png");
  }
});

test("a public page carries its canonical URL, share card and theme colours", async ({
  page,
}) => {
  await page.goto("/privacy");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Privacy · Galaxy Chat");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://galaxychat.tech/privacy",
  );
  await expect(page.locator(meta("og:title"))).toHaveAttribute(
    "content",
    "Privacy · Galaxy Chat",
  );
  await expect(page.locator(meta("og:image"))).toHaveAttribute(
    "content",
    /^https:\/\/galaxychat\.tech\/opengraph-image/,
  );
  await expect(page.locator(meta("twitter:card"))).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  await expect(page.locator(meta("theme-color"))).toHaveCount(2);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator(meta("robots"))).toHaveCount(0);
});

test("pages behind sign-in ask not to be indexed", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "E2E sign in" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator(meta("robots"))).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
  await expect(page.locator("main")).toHaveCount(1);
});
