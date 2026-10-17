import { expect, test } from "bun:test";
import { publicSiteOrigin } from "../lib/ui/public-site";

test("public metadata uses only a deliberately configured bare origin", () => {
  expect(publicSiteOrigin(undefined)).toBeUndefined();
  expect(publicSiteOrigin("")).toBeUndefined();
  expect(publicSiteOrigin("not a URL")).toBeUndefined();
  expect(publicSiteOrigin("https://example.test")).toBe("https://example.test");
  expect(publicSiteOrigin("https://example.test/")).toBe(
    "https://example.test",
  );
  expect(publicSiteOrigin("http://127.0.0.1:3059")).toBe(
    "http://127.0.0.1:3059",
  );
  expect(publicSiteOrigin("http://localhost:3059")).toBe(
    "http://localhost:3059",
  );
});

test("canonical metadata cannot publish credentials, fragments, or insecure remote origins", () => {
  for (const value of [
    "https://user:secret@example.test",
    "https://example.test/?token=private",
    "https://example.test/#private",
    "https://example.test/private-path",
    "http://example.test",
    "javascript:alert(1)",
    "file:///tmp/galaxy",
  ]) {
    expect(publicSiteOrigin(value)).toBeUndefined();
  }
});
