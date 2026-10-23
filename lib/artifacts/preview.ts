import { fromHtml } from "hast-util-from-html";
import { type Schema, sanitize } from "hast-util-sanitize";
import { toHtml } from "hast-util-to-html";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toHast } from "mdast-util-to-hast";
import { artifactLimits } from "./contract";

// A parser-based allowlist, not source substitution. No URL-bearing properties,
// styles, SVG/MathML, custom elements, forms, metadata, embeds, or active content.
const schema: Schema = {
  tagNames: [
    "p",
    "div",
    "span",
    "section",
    "article",
    "header",
    "footer",
    "main",
    "aside",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "strong",
    "em",
    "b",
    "i",
    "u",
    "s",
    "small",
    "mark",
    "sub",
    "sup",
    "br",
    "hr",
    "pre",
    "code",
    "blockquote",
    "ul",
    "ol",
    "li",
    "dl",
    "dt",
    "dd",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "caption",
    "figure",
    "figcaption",
    "details",
    "summary",
    "a",
  ],
  attributes: {
    "*": ["title", "lang", "dir"],
    th: ["colSpan", "rowSpan", "scope"],
    td: ["colSpan", "rowSpan"],
    ol: ["start"],
  },
  protocols: {},
  strip: [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "svg",
    "math",
    "template",
    "noscript",
  ],
  clobber: ["id", "name"],
};
export const artifactPreviewCsp =
  "default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'unsafe-inline'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
export function artifactPreviewDocument(source: string) {
  if (new TextEncoder().encode(source).byteLength > artifactLimits.contentBytes)
    source = "<p>Preview unavailable: source exceeds 128 KiB.</p>";
  let safe: string;
  try {
    const tree = fromHtml(source, { fragment: true });
    boundTree(tree);
    safe = toHtml(sanitize(tree, schema));
  } catch {
    // Deep/malformed input may exceed a parser's recursion limit. Keep the editor
    // available and return fixed inert markup, never the unparsed source.
    safe =
      "<p>Preview unavailable: source is too deeply nested or malformed.</p>";
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${artifactPreviewCsp}"><meta name="referrer" content="no-referrer"><style>html{color-scheme:light}body{margin:24px;font:16px/1.65 system-ui,sans-serif;color:#1c2535;overflow-wrap:anywhere}pre{overflow:auto;padding:16px;background:#f2f4f8}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid #cbd2df;padding:8px}blockquote{border-left:3px solid #9ba8be;padding-left:16px;margin-left:0}a{color:inherit}summary{cursor:pointer}</style></head><body>${safe}</body></html>`;
}

export function markdownPreviewDocument(source: string) {
  if (new TextEncoder().encode(source).byteLength > artifactLimits.contentBytes)
    return artifactPreviewDocument(
      "<p>Preview unavailable: source exceeds 128 KiB.</p>",
    );
  // CommonMark only: no MDX modules, imports, JSX, or executable extensions.
  try {
    const tree = fromMarkdown(source);
    boundTree(tree);
    return artifactPreviewDocument(toHtml(toHast(tree)));
  } catch {
    return artifactPreviewDocument(
      "<p>Preview unavailable: source is too deeply nested or malformed.</p>",
    );
  }
}

function boundTree(tree: { children?: unknown[] }) {
  const pending: Array<{ node: { children?: unknown[] }; depth: number }> = [
    { node: tree, depth: 0 },
  ];
  let remaining = 10000;
  while (pending.length) {
    const item = pending.pop();
    if (!item?.node.children) continue;
    if (item.depth >= 64 || remaining <= 0) {
      item.node.children = [];
      continue;
    }
    item.node.children = item.node.children.slice(0, remaining);
    remaining -= item.node.children.length;
    for (const child of item.node.children)
      if (child && typeof child === "object")
        pending.push({ node: child, depth: item.depth + 1 });
  }
}
