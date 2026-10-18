import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactEditor } from "../components/artifacts/artifact-workbench";
import {
  ChartDataTable,
  ChartPreview,
} from "../components/artifacts/chart-preview";
import { sampleChart } from "../lib/artifacts/chart-spec";

async function chartDom() {
  const window = new Window();
  Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      width: 800,
      height: 288,
      top: 0,
      right: 800,
      bottom: 288,
      left: 0,
      toJSON: () => ({}),
    }),
  });
  const values = {
    window,
    document: window.document,
    Event: window.Event,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
    ResizeObserver: window.ResizeObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = Object.entries(values).map(([name, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
    return { name, descriptor };
  });
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return {
    container,
    render: async (node: ReactNode) => {
      await act(async () => root.render(node));
    },
    close: async () => {
      await act(async () => root.unmount());
      await window.happyDOM.close();
      for (const { name, descriptor } of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

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

test("F12 large sparse line and area charts plot every isolated numeric value", async () => {
  const ui = await chartDom();
  try {
    for (const type of ["line", "area"] as const) {
      const spec = sampleChart(type);
      spec.series = [{ label: "Sparse values" }];
      spec.rows = Array.from({ length: 81 }, (_, index) => ({
        label: `Row ${index + 1}`,
        values: [[5, 40, 75].includes(index) ? index + 1 : null],
      }));
      await ui.render(<ChartPreview source={JSON.stringify(spec)} />);
      const marks = ui.container.querySelectorAll(
        `.recharts-${type}-dots circle[cx][cy]`,
      );
      expect(marks).toHaveLength(3);
      for (const mark of marks) {
        expect(Number.isFinite(Number(mark.getAttribute("cx")))).toBe(true);
        expect(Number.isFinite(Number(mark.getAttribute("cy")))).toBe(true);
      }
    }
  } finally {
    await ui.close();
  }
});
