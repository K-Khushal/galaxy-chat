import { expect, test } from "bun:test";
import { fromHtml } from "hast-util-from-html";
import { chartSvg } from "../lib/artifacts/chart-export";
import {
  chartDomain,
  chartLimits,
  chartSpec,
  parseChartSource,
  sampleChart,
} from "../lib/artifacts/chart-spec";
import { artifactFilename, artifactSource } from "../lib/artifacts/contract";

test("F12 chart JSON accepts only versioned bounded typed positional data for all four kinds", () => {
  for (const type of ["bar", "line", "area", "scatter"] as const) {
    const spec = sampleChart(type);
    expect(parseChartSource(JSON.stringify(spec))).toEqual({
      success: true,
      data: spec,
    });
  }
  const valid = sampleChart("line");
  valid.rows = [
    { label: "Negative", values: [-1e12, null] },
    { label: "Zero", values: [0, 1e12] },
  ];
  expect(chartSpec.safeParse(valid).success).toBe(true);
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    1e12 + 1,
    -1e12 - 1,
    "12",
    {},
    [],
    true,
  ])
    expect(
      chartSpec.safeParse({
        ...valid,
        rows: [{ label: "Bad", values: [value, null] }],
      }).success,
    ).toBe(false);
  for (const spec of [
    { ...valid, version: 2 },
    { ...valid, type: "pie" },
    { ...valid, title: " " },
    { ...valid, description: "x".repeat(1001) },
    { ...valid, title: "\u0000" },
    { ...valid, title: "\ud800" },
    { ...valid, title: "\ufffe" },
    { ...valid, title: "Trailing newline\n" },
    { ...valid, title: "x".repeat(121) },
    { ...valid, xAxis: { label: "x".repeat(81) } },
    { ...valid, series: [{ label: "x".repeat(81) }] },
    { ...valid, rows: [{ label: "x".repeat(121), values: [1, 2] }] },
    { ...valid, rows: [] },
    { ...valid, series: [] },
    { ...valid, rows: [{ label: "Ragged", values: [1] }] },
    { ...valid, rows: [{ label: "Empty", values: [null, null] }] },
    { ...valid, xAxis: { label: "Axis", formatter: "alert(1)" } },
    { ...valid, series: [{ label: "A", dataKey: "constructor.prototype" }] },
    {
      ...valid,
      rows: [{ label: "Label", values: [1, 2], html: "<b>Bad</b>" }],
    },
    {
      ...sampleChart("scatter"),
      rows: [{ label: "Partial", values: [{ x: 1 }, null] }],
    },
    { ...sampleChart("scatter"), rows: [{ label: "Number", values: [1, 2] }] },
    {
      ...sampleChart("scatter"),
      rows: [{ label: "Extra", values: [{ x: 1, y: 2, z: 3 }, null] }],
    },
    {
      ...sampleChart("scatter"),
      rows: [{ label: "Infinite", values: [{ x: Infinity, y: 2 }, null] }],
    },
  ])
    expect(chartSpec.safeParse(spec).success).toBe(false);
});

test("F12 chart schema rejects execution/remote fields, raw code, unknown/prototype keys, and all exact resource boundaries", () => {
  const spec = sampleChart();
  for (const [key, value] of Object.entries({
    data: "https://evil.invalid/data",
    url: "https://evil.invalid",
    formatter: "<img onerror=alert(1)>",
    callback: "() => fetch('/api/account')",
    components: ["Custom"],
    import: "https://evil.invalid/run.js",
    expression: "process.env",
    style: "url(https://evil.invalid)",
    __proto__: null,
    constructor: { prototype: { polluted: true } },
  }))
    expect(
      parseChartSource(JSON.stringify({ ...spec, [key]: value })).success,
    ).toBe(false);
  expect(
    parseChartSource(
      JSON.stringify(spec).replace('"version":1', '"__proto__":{},"version":1'),
    ).success,
  ).toBe(false);
  for (const source of [
    "",
    "null",
    "[]",
    "import X from 'x'",
    "export default () => <Chart/>",
    "```json\n{}\n```",
    '{"version":1,"value":NaN}',
    "(() => alert(1))()",
  ])
    expect(parseChartSource(source).success).toBe(false);
  const exact = {
    ...spec,
    series: Array.from({ length: 8 }, (_, i) => ({ label: `Series ${i}` })),
    rows: Array.from({ length: 250 }, (_, i) => ({
      label: String(i),
      values: Array(8).fill(1),
    })),
  };
  expect(parseChartSource(JSON.stringify(exact)).success).toBe(true);
  expect(
    chartSpec.safeParse({ ...exact, rows: [...exact.rows, exact.rows[0]] })
      .success,
  ).toBe(false);
  expect(
    chartSpec.safeParse({
      ...exact,
      series: [...exact.series, { label: "Ninth" }],
    }).success,
  ).toBe(false);
  const scatter = {
    ...sampleChart("scatter"),
    series: [{ label: "Pairs" }],
    rows: Array.from({ length: 1000 }, (_, i) => ({
      label: String(i),
      values: [{ x: i, y: -i }],
    })),
  };
  expect(parseChartSource(JSON.stringify(scatter)).success).toBe(true);
  expect(
    chartSpec.safeParse({
      ...scatter,
      rows: [...scatter.rows, scatter.rows[0]],
    }).success,
  ).toBe(false);
  const source = JSON.stringify(spec);
  const padded =
    source +
    " ".repeat(
      chartLimits.contentBytes - new TextEncoder().encode(source).byteLength,
    );
  expect(parseChartSource(padded).success).toBe(true);
  expect(parseChartSource(`${padded} `).success).toBe(false);
  expect(parseChartSource(`${source}${"😀".repeat(32768)}`).success).toBe(
    false,
  );
  expect(artifactFilename('../Unsafe" title', "chart")).toBe(
    "Unsafe-title.chart.json",
  );
  expect(
    artifactSource(
      [{ type: "text", text: `\`\`\`chart\n${source}\n\`\`\`` }],
      "chart",
    ),
  ).toBe(source);
  expect(
    artifactSource(
      [{ type: "text", text: `\`\`\`json\n${source}\n\`\`\`` }],
      "markdown",
    ),
  ).toContain("```json");
});

test("F12 SVG export is deterministic fixed inert markup with finite geometry and escaped hostile labels", () => {
  for (const type of ["bar", "line", "area", "scatter"] as const) {
    const spec = sampleChart(type);
    spec.title = '<script>fetch("https://evil.invalid")</script>';
    spec.description =
      '<img src="https://evil.invalid" onerror="alert(1)"> & text';
    const source = JSON.stringify(spec),
      svg = chartSvg(source);
    expect(svg).not.toBeNull();
    expect(svg).toBe(chartSvg(source));
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp; text");
    expect(svg).not.toMatch(
      /<(script|foreignObject|image|a|style|iframe|use)\b/i,
    );
    // Hostile words are valid escaped text; inspect real parsed attributes below.
    expect(svg).not.toMatch(/NaN|Infinity/);
    const nodes = [...fromHtml(svg ?? "", { fragment: true }).children];
    while (nodes.length) {
      const node = nodes.pop();
      if (node?.type !== "element") continue;
      expect([
        "svg",
        "title",
        "desc",
        "rect",
        "g",
        "text",
        "line",
        "circle",
        "path",
      ]).toContain(node.tagName);
      expect(
        Object.keys(node.properties).every(
          (key) => !/^(on|href|xlink|style)/i.test(key),
        ),
      ).toBe(true);
      for (const key of [
        "x",
        "y",
        "x1",
        "x2",
        "y1",
        "y2",
        "cx",
        "cy",
        "r",
        "width",
        "height",
      ])
        if (key in node.properties)
          expect(Number.isFinite(Number(node.properties[key]))).toBe(true);
      nodes.push(...node.children);
    }
  }
  for (const value of [0, 1e12, -1e12, 1e-300]) {
    const spec = sampleChart("line");
    spec.rows = [{ label: "Only", values: [value, null] }];
    expect(chartSvg(JSON.stringify(spec))).not.toMatch(/NaN|Infinity/);
  }
  expect(chartDomain([5, 5], false)).toEqual([4, 6]);
  expect(chartSvg("{}")).toBeNull();
  const max = {
    ...sampleChart("area"),
    series: [{ label: "Max" }],
    rows: Array.from({ length: 2000 }, (_, i) => ({
      label: String(i),
      values: [i],
    })),
  };
  expect(chartSvg(JSON.stringify(max))?.length).toBeLessThan(300_000);
});
