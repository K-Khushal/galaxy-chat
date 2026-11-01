import { expect, test } from "bun:test";
import manifest from "../app/manifest";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import {
  PRIVATE_PATHS,
  PUBLIC_PATHS,
  publicPageMetadata,
  SITE_URL,
} from "../lib/site";

test("robots.txt keeps crawlers out of the API and signed-in pages and points at the sitemap", () => {
  const { rules, sitemap: map } = robots();
  const rule = Array.isArray(rules) ? rules[0] : rules;
  expect(rule.userAgent).toBe("*");
  expect(rule.allow).toBe("/");
  expect(rule.disallow).toEqual(
    expect.arrayContaining(["/api/", "/chat", "/settings"]),
  );
  expect(map).toBe(`${SITE_URL}/sitemap.xml`);
});

test("sitemap lists only the public pages on the production origin", () => {
  const urls = sitemap().map((entry) => entry.url);
  expect(urls).toEqual([
    "https://galaxychat.tech",
    "https://galaxychat.tech/privacy",
    "https://galaxychat.tech/terms",
  ]);
  for (const url of urls)
    for (const path of PRIVATE_PATHS)
      expect(new URL(url).pathname.startsWith(path)).toBe(false);
});

test("public pages are canonical to themselves and share a titled card", () => {
  for (const path of PUBLIC_PATHS) {
    const meta = publicPageMetadata(path, "Privacy", "About this page.");
    expect(meta.alternates?.canonical).toBe(path);
    expect(meta.openGraph).toMatchObject({
      url: path,
      siteName: "Galaxy Chat",
    });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  }
});

test("the manifest names the app and carries an icon", () => {
  const app = manifest();
  expect(app.name).toBe("Galaxy Chat");
  expect(app.start_url).toBe("/");
  expect(app.icons?.length).toBeGreaterThan(0);
});

test("brand colours outside CSS still match the tokens and the icon", async () => {
  const brand = await Bun.file("lib/brand.json").json();
  const css = (await Bun.file("app/globals.css").text()).toUpperCase();
  const icon = (await Bun.file("app/icon.svg").text()).toLowerCase();
  // globals.css documents each theme's page colour next to its tokens.
  expect(css).toContain(brand.themeColor.light.toUpperCase());
  expect(css).toContain(brand.themeColor.dark.toUpperCase());
  expect(icon).toContain(brand.accent);
  expect(icon).toContain(`fill="#fff"`);
});
