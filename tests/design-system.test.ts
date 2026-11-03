import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { creditsLeft, formatCost } from "@/lib/credits/copy";
import { cn } from "@/lib/utils";

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

  test("primitives use transitions on named properties, not keyframe or `all`", () => {
    // The sidebar rail is ticket d's (#100); drop this exemption with it.
    const exempt = new Set([join("components", "ui", "sidebar.tsx")]);
    const offenders = sourceFiles(join("components", "ui"))
      .filter((file) => !exempt.has(file))
      .filter((file) =>
        /animate-in|animate-out|transition-all/.test(
          readFileSync(join(root, file), "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });

  test("icons take their colour and size from classes, never `style`", () => {
    const offenders = sourceFiles(join("components", "icons")).filter((file) =>
      /\bstyle=/.test(readFileSync(join(root, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  test("cn keeps a text role next to a text colour", () => {
    expect(cn("text-caption", "text-muted-foreground")).toBe(
      "text-caption text-muted-foreground",
    );
    expect(cn("text-message text-foreground")).toBe(
      "text-message text-foreground",
    );
    // Roles are font sizes, so they still replace one another.
    expect(cn("text-sm", "text-caption")).toBe("text-caption");
    expect(cn("text-heading", "text-display")).toBe("text-display");
  });
});

describe("Credits copy", () => {
  test("creditsLeft agrees in number", () => {
    expect(creditsLeft(1)).toBe("1 Credit left");
    expect(creditsLeft(0)).toBe("0 Credits left");
    expect(creditsLeft(12)).toBe("12 Credits left");
  });

  test("formatCost shows cents, or two significant digits below a cent", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.12)).toBe("$0.12");
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(0.123456)).toBe("$0.12");
    expect(formatCost(0.0042)).toBe("$0.0042");
    expect(formatCost(0.004219)).toBe("$0.0042");
    expect(formatCost(0.00000123)).toBe("$0.0000012");
  });
});

describe("primitives", () => {
  test("Button pending is busy and disabled, and keeps its label", () => {
    const html = renderToStaticMarkup(h(Button, { pending: true }, "Save"));
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<button[^>]* disabled=""/);
    expect(html).toContain('data-slot="spinner"');
    expect(html).toContain("Save");
    const idle = renderToStaticMarkup(h(Button, null, "Save"));
    expect(idle).not.toContain("aria-busy");
    expect(idle).not.toMatch(/<button[^>]* disabled=""/);
  });

  test("FieldError renders nothing without children", () => {
    expect(renderToStaticMarkup(h(FieldError))).toBe("");
    expect(renderToStaticMarkup(h(FieldError, null, ""))).toBe("");
    expect(renderToStaticMarkup(h(FieldError, null, null))).toBe("");
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
