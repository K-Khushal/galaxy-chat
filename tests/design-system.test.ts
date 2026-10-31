import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("design tokens", () => {
  test("no colour literals or palette classes outside globals.css", () => {
    const literal =
      /#[0-9a-fA-F]{3,8}\b|\b(?:oklch|oklab|rgba?|hsla?)\(\s*(?!in )|\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|shadow)-(?:black|white|red|blue|green|zinc|gray|slate|neutral|stone|amber|yellow|orange|indigo|violet|purple|pink|rose|emerald|teal|cyan|sky)\b/;
    const offenders = ["app", "components", "lib"]
      .flatMap(sourceFiles)
      .filter((file) => literal.test(readFileSync(join(root, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("/design route", () => {
  test("answers 404 in production", async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      const { default: DesignPage } = await import("@/app/design/page");
      expect(() => DesignPage()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
    } finally {
      env.NODE_ENV = previous;
    }
  });
});
