import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { buildCommand } = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  buildCommand: string;
};

/** Runs the Vercel build command with a fake `bun` that logs its arguments. */
function runBuild(env: Record<string, string>, failing = "") {
  const dir = mkdtempSync(join(tmpdir(), "fake-bun-"));
  const log = join(dir, "log");
  const bun = join(dir, "bun");
  writeFileSync(
    bun,
    `#!/bin/sh\necho "$*" >> "${log}"\n[ "$*" = "${failing}" ] && exit 1\nexit 0\n`,
  );
  chmodSync(bun, 0o755);
  const result = Bun.spawnSync(["sh", "-c", buildCommand], {
    env: { PATH: `${dir}:/usr/bin:/bin`, ...env },
  });
  let calls: string[] = [];
  try {
    calls = readFileSync(log, "utf8").trim().split("\n");
  } catch {}
  return { status: result.exitCode, calls };
}

test("production deployments migrate before building", () => {
  expect(runBuild({ VERCEL_ENV: "production" })).toEqual({
    status: 0,
    calls: ["run db:migrate", "run build"],
  });
});

test("preview and development builds never migrate", () => {
  for (const VERCEL_ENV of ["preview", "development", ""]) {
    expect(runBuild({ VERCEL_ENV })).toEqual({
      status: 0,
      calls: ["run build"],
    });
  }
});

test("a failed migration fails the build before it starts", () => {
  expect(runBuild({ VERCEL_ENV: "production" }, "run db:migrate")).toEqual({
    status: 1,
    calls: ["run db:migrate"],
  });
});
