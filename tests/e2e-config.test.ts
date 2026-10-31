import { expect, test } from "bun:test";
import { testE2eEnabled } from "../lib/env";

test("E2E seams require an explicit test runtime and are refused in production", () => {
  expect(testE2eEnabled({ NODE_ENV: "production" })).toBe(false);
  expect(testE2eEnabled({ NODE_ENV: "test" })).toBe(false);
  expect(testE2eEnabled({ NODE_ENV: "test", GALAXY_TEST_E2E: "1" })).toBe(true);
  for (const NODE_ENV of ["production", "development", undefined]) {
    expect(() => testE2eEnabled({ NODE_ENV, GALAXY_TEST_E2E: "1" })).toThrow();
  }
  for (const deployment of [
    { VERCEL: "1" },
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "production" },
  ]) {
    expect(() =>
      testE2eEnabled({ NODE_ENV: "test", GALAXY_TEST_E2E: "1", ...deployment }),
    ).toThrow();
  }
  expect(() =>
    testE2eEnabled({ NODE_ENV: "test", GALAXY_TEST_E2E: "true" }),
  ).toThrow();
});
