import { z } from "zod";

export const tableLimits = {
  contentBytes: 128 * 1024,
  rows: 10_000,
  columns: 50,
  cells: 200_000,
  cellCharacters: 4_096,
  exportBytes: 8 * 1024 * 1024,
  previewRows: 100,
} as const;

function validScalarText(value: string, allowLineBreaks: boolean) {
  return [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    if (allowLineBreaks && (code === 9 || code === 10 || code === 13))
      return true;
    return (
      code > 31 &&
      !(code >= 127 && code <= 159) &&
      !(code >= 0xd800 && code <= 0xdfff) &&
      (code & 0xffff) !== 0xfffe &&
      (code & 0xffff) !== 0xffff
    );
  });
}

const label = (max: number) =>
  z
    .string()
    .refine((value) => value.trim().length > 0)
    .refine((value) => [...value].length <= max)
    .refine((value) => validScalarText(value, false));
const textCell = z
  .string()
  .refine((value) => [...value].length <= tableLimits.cellCharacters)
  .refine((value) => validScalarText(value, true));
const cell = z.union([textCell, z.number().finite(), z.boolean()]);

export const tableSpec = z
  .object({
    version: z.literal(1),
    type: z.literal("table"),
    title: label(120),
    description: label(1000),
    columns: z
      .array(z.object({ label: label(120) }).strict())
      .min(1)
      .max(tableLimits.columns),
    rows: z
      .array(
        z
          .object({
            label: label(120),
            values: z.array(cell).max(tableLimits.columns),
          })
          .strict(),
      )
      .min(1)
      .max(tableLimits.rows),
  })
  .strict()
  .superRefine((spec, context) => {
    if (spec.rows.length * spec.columns.length > tableLimits.cells)
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Use at most 200,000 value slots.",
      });
    for (const [index, row] of spec.rows.entries())
      if (row.values.length !== spec.columns.length)
        context.addIssue({
          code: "custom",
          path: ["rows", index, "values"],
          message: "Each row needs one value per column.",
        });
  });

export type TableSpec = z.infer<typeof tableSpec>;
export type TableCell = TableSpec["rows"][number]["values"][number];
export type TableParseResult =
  | { success: true; data: TableSpec }
  | { success: false; error: string };

export function parseTableSource(source: string): TableParseResult {
  if (new TextEncoder().encode(source).byteLength > tableLimits.contentBytes)
    return { success: false, error: "Table JSON must fit within 128 KiB." };
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return {
      success: false,
      error:
        "Enter a complete table JSON object. No JavaScript or Markdown is accepted.",
    };
  }
  const parsed = tableSpec.safeParse(raw);
  if (!parsed.success)
    return {
      success: false,
      error:
        "Check table version 1, title, description, columns and rows. Use only text, finite numbers or booleans, with one value per column and at most 10,000 rows / 50 columns / 200,000 value slots.",
    };
  return { success: true, data: parsed.data };
}

export function tableCellText(value: TableCell) {
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

export function tableExportFits(bytes: Uint8Array) {
  return bytes.byteLength <= tableLimits.exportBytes;
}

export function sampleTable(): TableSpec {
  return {
    version: 1,
    type: "table",
    title: "Quarterly adjustments",
    description:
      "Approved adjustments by quarter. Text that resembles a formula remains text.",
    columns: [
      { label: "Quarter" },
      { label: "Adjustment" },
      { label: "Approved" },
      { label: "Note" },
    ],
    rows: [
      {
        label: "Entry 1",
        values: ["Q1", -42, true, '=WEBSERVICE("https://example.invalid")'],
      },
      {
        label: "Entry 2",
        values: ["Q2", 18.5, false, "Line one\nLine two 😀"],
      },
    ],
  };
}
