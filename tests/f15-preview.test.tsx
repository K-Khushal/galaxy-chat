import { expect, test } from "bun:test";
import LandingPreviewPage from "../app/preview/landing/page";

function inEnvironment(
  mode: string,
  flag: string | undefined,
  check: () => void,
) {
  const previousMode = process.env.NODE_ENV;
  const previousFlag = process.env.F04_UI_HARNESS;
  Object.assign(process.env, { NODE_ENV: mode });
  if (flag === undefined) delete process.env.F04_UI_HARNESS;
  else process.env.F04_UI_HARNESS = flag;
  try {
    check();
  } finally {
    if (previousMode === undefined)
      Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: previousMode });
    if (previousFlag === undefined) delete process.env.F04_UI_HARNESS;
    else process.env.F04_UI_HARNESS = previousFlag;
  }
}

test("landing preview route returns Next 404 outside explicit development opt-in", () => {
  for (const [mode, flag] of [
    ["production", "1"],
    ["production", undefined],
    ["test", "1"],
    ["development", undefined],
    ["development", "0"],
  ]) {
    inEnvironment(mode ?? "", flag, () => {
      expect(() => LandingPreviewPage()).toThrow(
        "NEXT_HTTP_ERROR_FALLBACK;404",
      );
    });
  }
  inEnvironment("development", "1", () => {
    expect(LandingPreviewPage()).toBeDefined();
  });
});
