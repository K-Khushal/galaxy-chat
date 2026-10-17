import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactEditor } from "../components/artifacts/artifact-workbench";
import {
  ChartDataTable,
  ChartPreview,
} from "../components/artifacts/chart-preview";
import { sampleChart } from "../lib/artifacts/chart-spec";

test("F12 chart previews expose an accessible description and equivalent scoped data table with exact values and explicit missing cells", () => {
  for (const type of ["bar", "line", "area", "scatter"] as const) {
    const spec = sampleChart(type);
    const html = renderToStaticMarkup(
      <ChartPreview source={JSON.stringify(spec)} />,
    );
    expect(html).toContain(spec.title);
    expect(html).toContain(spec.description);
    expect(html).toContain("aria-describedby=");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain("Missing");
    for (const row of spec.rows) expect(html).toContain(row.label);
    for (const series of spec.series) expect(html).toContain(series.label);
    const table = renderToStaticMarkup(<ChartDataTable spec={spec} />);
    if (spec.type === "scatter") {
      for (const row of spec.rows)
        for (const value of row.values) {
          expect(table).toContain(`>${value?.x ?? "Missing"}</td>`);
          expect(table).toContain(`>${value?.y ?? "Missing"}</td>`);
        }
      expect(table.match(/scope="col"/g)).toHaveLength(
        1 + spec.series.length * 2,
      );
    } else {
      for (const row of spec.rows)
        for (const value of row.values)
          expect(table).toContain(`>${value ?? "Missing"}</td>`);
      expect(table.match(/scope="col"/g)).toHaveLength(1 + spec.series.length);
    }
  }
});

test("F12 invalid and hostile charts fail closed while the editor remains labeled and provides save/history/export controls", () => {
  for (const source of [
    "{}",
    "",
    "[]",
    JSON.stringify({ ...sampleChart(), rows: [] }),
  ]) {
    const html = renderToStaticMarkup(<ChartPreview source={source} />);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("recharts");
    const editor = renderToStaticMarkup(
      <ArtifactEditor
        document={{
          id: "chart",
          chatId: "chat",
          messageId: "message",
          kind: "chart",
          title: "Chart",
          content: source,
          version: 1,
          updatedAt: "2026-10-17",
          revisions: [],
        }}
        onChange={() => {}}
        onDeleted={() => {}}
      />,
    );
    expect(editor).toContain("Chart JSON");
    expect(editor).toContain('aria-invalid="true"');
    expect(editor).toContain("Save revision");
    expect(editor).toContain("History");
    expect(editor).toContain("Download saved chart JSON");
    expect(editor).toContain("Download saved SVG");
  }
  const spec = sampleChart();
  spec.title = "<script>parent.compromised=true</script>";
  spec.rows[0].label = "<img src=https://evil.invalid onerror=alert(1)>";
  const html = renderToStaticMarkup(
    <ChartPreview source={JSON.stringify(spec)} />,
  );
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
});
