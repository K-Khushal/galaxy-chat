import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

// Keep the DOM and React development runtime isolated from server tests that
// deliberately load Next.js with NODE_ENV=production.
test("chat component interactions", () => {
  const result = spawnSync(
    process.execPath,
    ["test", "./tests/ui/chat-components.tsx"],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "test" },
      encoding: "utf8",
    },
  );
  expect(result.stderr).toContain("0 fail");
  expect(result.status).toBe(0);
});
