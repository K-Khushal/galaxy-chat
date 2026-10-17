import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Optional local QA dependency. Production has no browser runtime or execution API.
const moduleName = process.env.F11_PLAYWRIGHT_MODULE;
const { chromium } = await import(
  moduleName ? pathToFileURL(resolve(moduleName)).href : "playwright"
);
const origin = process.env.F11_PREVIEW_ORIGIN ?? "http://127.0.0.1:3111";
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const output = resolve(process.env.F11_CAPTURE_DIR ?? ".ui-review/f11");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const remote = [];
    const errors = [];
    const navigations = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).hostname.endsWith(".invalid"))
        remote.push(request.url());
    });
    page.on("framenavigated", (frame) => navigations.push(frame.url()));
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin && !["about:", "data:"].includes(url.protocol))
        return route.abort();
      return route.continue();
    });
    await page.goto(`${origin}/preview/artifacts`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: "Create artifact", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Launch notes");
    await page.getByLabel("Format", { exact: true }).selectOption("html");
    await page
      .getByRole("button", { name: "Create artifact", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "HTML source", exact: true })
      .waitFor();
    await page.screenshot({ path: `${output}/source-${width}.png` });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const iframe = page.frameLocator('iframe[title="HTML artifact preview"]');
    await iframe.getByRole("heading", { name: "Launch notes" }).waitFor();
    const frame = page
      .frames()
      .find((candidate) => candidate.url() === "about:srcdoc");
    assert.ok(frame);
    const isolation = await frame.evaluate(() => {
      let parentDenied = false;
      try {
        void parent.document.cookie;
      } catch (error) {
        parentDenied = error.name === "SecurityError";
      }
      return {
        parentDenied,
        url: location.href,
        activeNodes: document.querySelectorAll(
          "script,img,iframe,form,object,embed,svg,math,link,base",
        ).length,
        navigable: document.querySelectorAll("[href],[src],[action],[target]")
          .length,
      };
    });
    assert.equal(isolation.parentDenied, true);
    assert.equal(isolation.activeNodes, 0);
    assert.equal(isolation.navigable, 0);
    assert.equal(
      await page.evaluate(() => document.body.dataset.compromised),
      undefined,
    );
    await iframe
      .getByText("External link is disabled", { exact: true })
      .click();
    assert.equal(frame.url(), "about:srcdoc");
    assert.equal(page.url(), `${origin}/preview/artifacts`);
    assert.equal(context.pages().length, 1);
    assert.deepEqual(remote, []);
    await page.screenshot({ path: `${output}/preview-${width}.png` });
    await page
      .getByRole("button", { name: "Edit source", exact: true })
      .click();
    const source = page.getByRole("textbox", {
      name: "HTML source",
      exact: true,
    });
    await source.fill("<h1>Revised notes</h1><p>Draft for review</p>");
    await page.keyboard.press("Escape");
    await page
      .getByText("Save or discard your changes before closing this artifact.")
      .waitFor();
    await page
      .getByRole("button", { name: "Save revision", exact: true })
      .click();
    await page.getByText("Saved revision 2.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "History", exact: true }).click();
    await page.getByLabel("Saved revision", { exact: true }).selectOption("1");
    await page
      .getByRole("button", { name: "Restore as new revision", exact: true })
      .click();
    await page
      .getByText("Revision 1 restored as revision 3.", { exact: true })
      .waitFor();
    await page.screenshot({ path: `${output}/history-${width}.png` });
    await page
      .getByRole("button", { name: "Edit source", exact: true })
      .click();
    assert.ok((await source.inputValue()).includes("<h1>Launch notes</h1>"));
    await source.fill(`<p>${"unbreakable".repeat(10000)}</p>`);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await iframe
      .getByText("unbreakable".repeat(10000), { exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.equal(
      await page
        .frames()
        .find((candidate) => candidate.url() === "about:srcdoc")
        ?.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Create artifact", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Create artifact", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.getByRole("button", { name: "Artifacts", exact: true }).click();
    await page
      .getByRole("button", { name: /Launch notes.*Revision 3/ })
      .click();
    await page
      .getByRole("button", { name: "Delete artifact", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Delete all revisions", exact: true })
      .click();
    await page
      .getByText(
        "Use “Create artifact” under a saved response to start a document.",
      )
      .waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(remote, []);
    console.info(
      JSON.stringify({
        width,
        isolation,
        remoteRequests: remote.length,
        popups: context.pages().length - 1,
        pageErrors: errors,
        screenshots: output,
        navigations,
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
