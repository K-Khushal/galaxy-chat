import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  projects: ["chromium", "firefox", "webkit"].flatMap((browserName) =>
    [false, true].map((mobile) => ({
      name: `${browserName}-${mobile ? "mobile" : "desktop"}`,
      use: {
        browserName: browserName as "chromium" | "firefox" | "webkit",
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1280, height: 800 },
        hasTouch: mobile,
      },
    })),
  ),
  fullyParallel: false,
  workers: 3,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:34871",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
  },
  webServer: {
    command: "bun --no-env-file tests/e2e/server.ts",
    url: "http://127.0.0.1:34871/api/test-e2e/sign-in",
    timeout: 180000,
    reuseExistingServer: false,
  },
});
