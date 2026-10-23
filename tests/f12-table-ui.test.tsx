import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactEditor } from "../components/artifacts/artifact-workbench";
import {
  TableDataTable,
  TablePreview,
} from "../components/artifacts/table-preview";
import { sampleTable } from "../lib/artifacts/table-spec";

test("F12-B table preview exposes a caption, scoped headers, exact primitive values, and explicit empty text", () => {
  const spec = sampleTable();
  spec.rows[0].values = ["", -42, true, "مرحبا 😀\nsecond line"];
  const html = renderToStaticMarkup(
    <TablePreview source={JSON.stringify(spec)} />,
  );
  expect(html).toContain("<caption");
  expect(html).toContain(spec.title);
  expect(html).toContain(spec.description);
  expect(html.match(/scope="col"/g)).toHaveLength(spec.columns.length + 1);
  expect(html.match(/scope="row"/g)).toHaveLength(spec.rows.length);
  expect(html).toContain("Empty text");
  expect(html).toContain(">-42</td>");
  expect(html).toContain(">True</td>");
  expect(html).toContain("مرحبا 😀\nsecond line");
  expect(html).not.toContain("<script");
});

test("F12-B paginated table keeps every bounded row reachable without rendering the whole document", () => {
  const spec = sampleTable();
  spec.rows = Array.from({ length: 101 }, (_, index) => ({
    label: `Row ${index + 1}`,
    values: [`Value ${index + 1}`, index, index % 2 === 0, "text"],
  }));
  const first = renderToStaticMarkup(
    <TablePreview source={JSON.stringify(spec)} />,
  );
  expect(first).toContain("Rows 1–100 of 101");
  expect(first).toContain("Next rows");
  expect(first).toContain("Row 100");
  expect(first).not.toContain("Row 101</th>");
  const second = renderToStaticMarkup(<TableDataTable spec={spec} page={1} />);
  expect(second).toContain("Row 101");
  expect(second).toContain("Value 101");
  expect(second).not.toContain("Row 100</th>");
});

test("F12-B invalid tables fail closed and editor exports the explicitly selected immutable revision", () => {
  const spec = sampleTable();
  const source = JSON.stringify(spec);
  const invalid = renderToStaticMarkup(<TablePreview source="{}" />);
  expect(invalid).toContain('role="alert"');
  expect(invalid).not.toContain("<table");
  const editor = renderToStaticMarkup(
    <ArtifactEditor
      document={{
        id: "table-id",
        chatId: "chat",
        messageId: "message",
        kind: "table",
        title: "Typed table",
        content: source,
        version: 2,
        updatedAt: "2026-10-18",
        revisions: [
          {
            version: 2,
            title: "Typed table",
            restoredFrom: null,
            createdAt: "2026-10-18",
          },
          {
            version: 1,
            title: "Original",
            restoredFrom: null,
            createdAt: "2026-10-18",
          },
        ],
      }}
      onChange={() => {}}
      onDeleted={() => {}}
    />,
  );
  expect(editor).toContain("Table JSON");
  expect(editor).toContain("Download revision 2 CSV");
  expect(editor).toContain("Download revision 2 XLSX");
  expect(editor).toContain(
    "/api/artifacts?id=table-id&amp;version=2&amp;download=csv",
  );
  expect(editor).toContain("saved JSON is unchanged");

  const badEditor = renderToStaticMarkup(
    <ArtifactEditor
      document={{
        id: "bad",
        chatId: "chat",
        messageId: "message",
        kind: "table",
        title: "Bad",
        content: "{}",
        version: 1,
        updatedAt: "2026-10-18",
        revisions: [],
      }}
      onChange={() => {}}
      onDeleted={() => {}}
    />,
  );
  expect(badEditor).toContain('aria-invalid="true"');
  expect(badEditor).toContain('role="alert"');
});
