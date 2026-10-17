import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".f01-preview");
const port = 4317;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const cssSource = await Bun.file(join(root, "app/globals.css")).text();
const cssResult = await postcss([tailwind()]).process(cssSource, {
  from: join(root, "app/globals.css"),
});
writeFileSync(join(outDir, "preview.css"), cssResult.css);

const built = await Bun.build({
  entrypoints: [join(root, "scripts/f01-preview-entry.tsx")],
  outdir: outDir,
  target: "browser",
  naming: "preview-[hash].[ext]",
});
if (!built.success) {
  for (const log of built.logs) {
    process.stderr.write(`${log.message}\n`);
  }
  process.exit(1);
}

const scripts = built.outputs
  .map((output) => relative(outDir, output.path))
  .filter((name) => name.endsWith(".js"))
  .map((name) => `<script type="module" src="/${name}"></script>`)
  .join("\n    ");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>F01 compatibility prototype</title>
    <link rel="stylesheet" href="/preview.css" />
  </head>
  <body>
    <div id="root"></div>
    ${scripts}
  </body>
</html>
`;
writeFileSync(join(outDir, "index.html"), html);

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const requested =
      url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (requested.includes("..")) {
      return new Response("Not found", { status: 404 });
    }
    const file = Bun.file(join(outDir, requested));
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(file);
  },
});

process.stdout.write(`f01 preview http://127.0.0.1:${port}\n`);
