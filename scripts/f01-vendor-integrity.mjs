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
  if (!expected || !relativePath) {
    throw new Error("Malformed checksum line");
  }
  const bytes = readFileSync(join(root, relativePath));
  const actual = createHash("sha256").update(bytes).digest("hex");
  assert.equal(actual, expected, relativePath);
}

process.stdout.write("f01 vendor integrity passed\n");
