import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const checksumFile = readFileSync(
  join(root, "vendor/halaska/SHA256SUMS"),
  "utf8",
);

for (const line of checksumFile.split("\n")) {
  if (line.trim().length === 0) {
    continue;
  }
  const [expected, relativePath] = line.split("  ");
  const bytes = readFileSync(join(root, relativePath));
  const actual = createHash("sha256").update(bytes).digest("hex");
  assert.equal(actual, expected, relativePath);
}

const kit = readFileSync(join(root, "vendor/halaska/halaska-kit.jsx"));
assert.equal(kit.length, 739157);
assert.equal(kit.includes(0), true);

const kitText = kit.toString("utf8");
assert.equal(kitText.startsWith('"use client";'), true);
assert.equal(kitText.includes("MIT License"), true);
assert.equal(kitText.includes("function ThemeProvider("), true);
assert.equal(kitText.includes("function Dialog("), true);
assert.equal(kitText.includes("function TextArea("), true);
assert.equal(kitText.includes("function setKitMotion("), true);

const shim = readFileSync(
  join(root, "vendor/halaska/halaska-kit.d.ts"),
  "utf8",
);
assert.equal(shim.includes("export declare const ThemeProvider"), true);
assert.equal(shim.includes("export declare const Dialog"), true);
assert.equal(shim.includes("export declare const TextArea"), true);
assert.equal(shim.includes("export declare const setKitMotion"), true);

const license = readFileSync(join(root, "vendor/halaska/LICENSE"), "utf8");
assert.equal(license.startsWith("MIT License"), true);
assert.equal(license.includes("Copyright (c) 2026 Halaska Studio"), true);

const prototype = readFileSync(
  join(root, "components/spike/halaska-elements-prototype.tsx"),
  "utf8",
);
assert.equal(prototype.includes("@/vendor/halaska/halaska-kit"), true);
assert.equal(prototype.includes("@/components/elements/conversation"), true);
assert.equal(prototype.includes("@/components/elements/message"), true);
assert.equal(prototype.includes("@/components/elements/response"), true);
assert.equal(prototype.includes("PromptInputPattern"), false);
assert.equal(prototype.includes("fetch("), false);
assert.equal(prototype.includes("streamText"), false);

const page = readFileSync(join(root, "app/spike/f01/page.tsx"), "utf8");
assert.equal(page.includes("HalaskaElementsPrototype"), true);

process.stdout.write("f01 vendor smoke passed\n");
