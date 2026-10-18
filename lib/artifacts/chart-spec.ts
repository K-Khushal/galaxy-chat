import { z } from "zod";

export const chartLimits = {
  contentBytes: 128 * 1024,
  series: 8,
  cells: 2000,
  magnitude: 1e12,
} as const;

const text = (max: number) =>
  z
    .string()
    .refine((value) =>
      [...value].every((char) => {
        const code = char.codePointAt(0) ?? 0;
        // Keep labels valid Unicode/XML text for both React and SVG exports.
        return (
          code > 31 &&
          !(code >= 127 && code <= 159) &&
          !(code >= 0xd800 && code <= 0xdfff) &&
          (code & 0xffff) !== 0xfffe &&
          (code & 0xffff) !== 0xffff
        );
      }),
    )
    .trim()
    .min(1)
    .max(max);
const number = z
  .number()
  .finite()
  .min(-chartLimits.magnitude)
  .max(chartLimits.magnitude);
const common = {
  version: z.literal(1),
  title: text(120),
  description: text(1000),
  xAxis: z.object({ label: text(80) }).strict(),
  yAxis: z.object({ label: text(80) }).strict(),
  series: z
    .array(z.object({ label: text(80) }).strict())
    .min(1)
    .max(chartLimits.series),
};
const categoryRows = z
  .array(
    z
      .object({
        label: text(120),
        values: z.array(number.nullable()).min(1).max(chartLimits.series),
      })
      .strict(),
  )
  .min(1)
  .max(chartLimits.cells);
const scatterRows = z
  .array(
    z
      .object({
        label: text(120),
        values: z
          .array(z.object({ x: number, y: number }).strict().nullable())
          .min(1)
          .max(chartLimits.series),
      })
      .strict(),
  )
  .min(1)
  .max(chartLimits.cells / 2);

export const chartSpec = z
  .discriminatedUnion("type", [
    z
      .object({ ...common, type: z.literal("bar"), rows: categoryRows })
      .strict(),
    z
      .object({ ...common, type: z.literal("line"), rows: categoryRows })
      .strict(),
    z
      .object({ ...common, type: z.literal("area"), rows: categoryRows })
      .strict(),
    z
      .object({ ...common, type: z.literal("scatter"), rows: scatterRows })
      .strict(),
  ])
  .superRefine((spec, ctx) => {
    const weight = spec.type === "scatter" ? 2 : 1;
    if (spec.rows.length * spec.series.length * weight > chartLimits.cells)
      ctx.addIssue({
        code: "custom",
        path: ["rows"],
        message:
          "Use at most 2,000 scalar value slots, including missing values (scatter pairs, including missing pairs, count as two).",
      });
    for (const [index, row] of spec.rows.entries())
      if (row.values.length !== spec.series.length)
        ctx.addIssue({
          code: "custom",
          path: ["rows", index, "values"],
          message: "Each row needs one value per series.",
        });
    if (!spec.rows.some((row) => row.values.some((value) => value !== null)))
      ctx.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Include at least one numeric value.",
      });
  });
export type ChartSpec = z.infer<typeof chartSpec>;
export type ChartType = ChartSpec["type"];
export type ChartParseResult =
  | { success: true; data: ChartSpec }
  | { success: false; error: string };

export function parseChartSource(source: string): ChartParseResult {
  if (new TextEncoder().encode(source).byteLength > chartLimits.contentBytes)
    return { success: false, error: "Chart JSON must fit within 128 KiB." };
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return {
      success: false,
      error:
        "Enter a complete chart JSON object. No JavaScript or Markdown is accepted.",
    };
  }
  const result = chartSpec.safeParse(raw);
  if (!result.success) {
    // Do not echo untrusted keys, values, or parser diagnostics into errors.
    return {
      success: false,
      error:
        "Check chart version 1, type, title, description, axes, series and rows. Use only supported fields, finite numbers within ±1 trillion, and at most 8 series / 2,000 scalar value slots including missing values.",
    };
  }
  return { success: true, data: result.data };
}

// Fixed palette and generated data keys are owned by the application.
export const chartColors = [
  "#315ac7",
  "#b34a16",
  "#137d68",
  "#8a3db8",
  "#a32f65",
  "#607c11",
  "#147c9b",
  "#685648",
] as const;
export const chartDashes = [
  "",
  "8 3",
  "3 3",
  "10 3 2 3",
  "5 2",
  "2 2",
  "12 4",
  "6 3 2 3",
] as const;
export const chartValue = (value: number | null) =>
  value === null ? "Missing" : String(value);
export function truncateChartText(value: string, length: number) {
  const characters = [...value];
  return characters.length > length
    ? `${characters.slice(0, length - 1).join("")}…`
    : value;
}
export const chartTick = (value: string | number) => {
  return truncateChartText(String(value), 16);
};
export function chartDomain(
  values: number[],
  includeZero = true,
): [number, number] {
  let min = includeZero ? 0 : (values[0] ?? 0);
  let max = min;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (min === max) return [min - 1, max + 1];
  return [min, max];
}

export function sampleChart(type: ChartType = "bar"): ChartSpec {
  const base = {
    version: 1 as const,
    title: "Launch support requests",
    description:
      "Requests received and resolved each week. Missing values are not zero.",
    xAxis: { label: "Week" },
    yAxis: { label: "Requests" },
    series: [{ label: "Received" }, { label: "Resolved" }],
  };
  if (type === "scatter")
    return {
      ...base,
      type,
      title: "Response time and satisfaction",
      description:
        "Each point represents a support team. Coordinates are response time and satisfaction score.",
      xAxis: { label: "Response time (hours)" },
      yAxis: { label: "Satisfaction score" },
      series: [{ label: "This month" }, { label: "Last month" }],
      rows: [
        {
          label: "Support",
          values: [
            { x: 2, y: 92 },
            { x: 4, y: 83 },
          ],
        },
        { label: "Billing", values: [{ x: 3, y: 89 }, null] },
        {
          label: "Technical",
          values: [
            { x: 6, y: 80 },
            { x: 8, y: 74 },
          ],
        },
      ],
    };
  return {
    ...base,
    type,
    rows: [
      { label: "Week 1", values: [24, 20] },
      { label: "Week 2", values: [35, 30] },
      { label: "Week 3", values: [28, null] },
      { label: "Week 4", values: [42, 39] },
    ],
  };
}
