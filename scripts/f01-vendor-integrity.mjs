import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const checksumPath of [
  "vendor/halaska/SHA256SUMS",
  "vendor/sheetjs/SHA256SUMS",
]) {
  const checksumFile = readFileSync(join(root, checksumPath), "utf8");
  for (const line of checksumFile.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const [expected, relativePath] = line.split("  ");
    if (!expected || !relativePath) {
      throw new Error(`Malformed checksum line in ${checksumPath}`);
    }
    const bytes = readFileSync(join(root, relativePath));
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, expected, relativePath);
  }
}

process.stdout.write("vendor integrity passed\n");
