import { expect, mock, test } from "bun:test";
import * as XLSX from "xlsx";
import { artifactSource, tableExportFilename } from "../lib/artifacts/contract";
import { neutralizeCsvText, tableCsv } from "../lib/artifacts/table-csv";
import {
  parseTableSource,
  sampleTable,
  tableExportFits,
  tableLimits,
  tableSpec,
} from "../lib/artifacts/table-spec";

mock.module("server-only", () => ({}));
const { tableXlsx } = await import("../lib/artifacts/table-xlsx");

function parseCsv(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\r" && text[index + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index++;
    } else field += character;
  }
  expect(quoted).toBe(false);
  expect(row).toEqual([]);
  return rows;
}

test("F12-B table JSON preserves primitive cell types and rejects executable or unbounded shapes", () => {
  const spec = sampleTable();
  expect(parseTableSource(JSON.stringify(spec))).toEqual({
    success: true,
    data: spec,
  });
  for (const value of [null, [], {}, { formula: "1+1" }, NaN, Infinity])
    expect(
      tableSpec.safeParse({
        ...spec,
        rows: [{ label: "Bad", values: [value, 1, true, "text"] }],
      }).success,
    ).toBe(false);
  for (const candidate of [
    { ...spec, version: 2 },
    { ...spec, type: "workbook" },
    { ...spec, title: " " },
    { ...spec, title: "bad\nlabel" },
    { ...spec, description: "\ud800" },
    { ...spec, extra: "unknown" },
    { ...spec, columns: [] },
    { ...spec, columns: Array.from({ length: 51 }, () => ({ label: "C" })) },
    { ...spec, rows: [] },
    { ...spec, rows: [{ label: "Ragged", values: ["only one"] }] },
    {
      ...spec,
      rows: [{ label: "Long", values: ["😀".repeat(4097), 1, true, "x"] }],
    },
    {
      ...spec,
      rows: [{ label: "Control", values: ["bad\u0001", 1, true, "x"] }],
    },
  ])
    expect(tableSpec.safeParse(candidate).success).toBe(false);

  const exactCell = sampleTable();
  exactCell.rows[0].values[0] = "😀".repeat(tableLimits.cellCharacters);
  expect(tableSpec.safeParse(exactCell).success).toBe(true);
  const source = JSON.stringify(spec);
  const exactSource =
    source +
    " ".repeat(
      tableLimits.contentBytes - new TextEncoder().encode(source).byteLength,
    );
  expect(parseTableSource(exactSource).success).toBe(true);
  expect(parseTableSource(`${exactSource} `).success).toBe(false);
  expect(tableExportFits(new Uint8Array(tableLimits.exportBytes))).toBe(true);
  expect(tableExportFits(new Uint8Array(tableLimits.exportBytes + 1))).toBe(
    false,
  );
});

test("F12-B table slot, row, and column ceilings include every positional value", () => {
  const columns = Array.from({ length: 50 }, (_, index) => ({
    label: `Column ${index}`,
  }));
  const row = { label: "Row", values: Array(50).fill(0) };
  expect(
    tableSpec.safeParse({
      version: 1,
      type: "table",
      title: "Exact slots",
      description: "Exactly two hundred thousand slots.",
      columns,
      rows: Array(4000).fill(row),
    }).success,
  ).toBe(true);
  expect(
    tableSpec.safeParse({
      version: 1,
      type: "table",
      title: "Too many slots",
      description: "One row exceeds the slot bound.",
      columns,
      rows: Array(4001).fill(row),
    }).success,
  ).toBe(false);
  const oneColumn = [{ label: "Only" }];
  const oneValue = { label: "Row", values: [0] };
  expect(
    tableSpec.safeParse({
      version: 1,
      type: "table",
      title: "Rows",
      description: "Exact row ceiling.",
      columns: oneColumn,
      rows: Array(10_000).fill(oneValue),
    }).success,
  ).toBe(true);
  expect(
    tableSpec.safeParse({
      version: 1,
      type: "table",
      title: "Rows",
      description: "Over row ceiling.",
      columns: oneColumn,
      rows: Array(10_001).fill(oneValue),
    }).success,
  ).toBe(false);
});

test("F12-B CSV round-trips Unicode, delimiters and multiline cells while neutralizing every dangerous text prefix", () => {
  const dangerous = [
    "=1+1",
    "+cmd",
    "-42",
    "@SUM(A1:A2)",
    "  =space",
    "\t=tab",
    "\r=return",
    "\n=line",
    "\u00a0=nbsp",
    "\ufeff=bom",
    "\u200b=zero-width",
    "\u202e=rtl-control",
    "\u2003=em-space",
    "＝fullwidth",
    "＋fullwidth",
    "－fullwidth",
    "＠fullwidth",
  ];
  for (const value of dangerous)
    expect(neutralizeCsvText(value)).toBe(`\t${value}`);
  for (const value of ["ordinary", "1+1", "https://example.invalid", "'=1"])
    expect(neutralizeCsvText(value)).toBe(value);

  const spec = {
    version: 1 as const,
    type: "table" as const,
    title: "CSV",
    description: "Round trip",
    columns: [{ label: "Text" }, { label: "Number" }, { label: "Boolean" }],
    rows: dangerous.map((value, index) => ({
      label: index === 0 ? 'Label, with quote " and newline\n' : `Row ${index}`,
      values: [
        index === 0 ? `${value}, "quoted"\nمرحبا 😀` : value,
        -42,
        index % 2 === 0,
      ],
    })),
  };
  const sourceBefore = JSON.stringify(spec);
  const bytes = tableCsv(spec);
  expect(bytes.byteLength).toBeLessThan(tableLimits.exportBytes);
  const rows = parseCsv(bytes);
  expect(rows).toHaveLength(spec.rows.length + 1);
  expect(rows[0]).toEqual(["Row", "Text", "Number", "Boolean"]);
  expect(rows[1][0]).toBe(spec.rows[0].label);
  expect(rows[1][1]).toBe(`\t${spec.rows[0].values[0]}`);
  expect(rows[1][2]).toBe("-42");
  expect(rows[1][3]).toBe("TRUE");
  expect(rows[2][3]).toBe("FALSE");
  for (let index = 1; index < dangerous.length; index++)
    expect(rows[index + 1][1]).toBe(`\t${dangerous[index]}`);
  expect(JSON.stringify(spec)).toBe(sourceBefore);
  expect(new TextDecoder().decode(bytes)).toContain("\r\n");
});

test("F12-B XLSX has one typed inert sheet with no formula, macro, external-reference, or hyperlink objects", () => {
  const spec = sampleTable();
  spec.columns[0].label = "<Column & one>";
  spec.rows[0].values = [
    '=WEBSERVICE("https://evil.invalid")',
    -42,
    true,
    "https://evil.invalid/😀\nplain text",
  ];
  const bytes = tableXlsx(spec);
  expect(bytes.byteLength).toBeGreaterThan(0);
  expect(bytes.byteLength).toBeLessThan(tableLimits.exportBytes);
  const workbook = XLSX.read(bytes, {
    type: "buffer",
    cellFormula: true,
    bookFiles: true,
    bookVBA: true,
  }) as XLSX.WorkBook & {
    keys: string[];
    files: Record<string, { content?: Uint8Array | string }>;
  };
  expect(workbook.SheetNames).toEqual(["Table"]);
  expect(workbook.vbaraw).toBeUndefined();
  const sheet = workbook.Sheets.Table;
  expect(sheet.B2).toMatchObject({
    t: "s",
    v: '=WEBSERVICE("https://evil.invalid")',
  });
  expect(sheet.C2).toMatchObject({ t: "n", v: -42 });
  expect(sheet.D2).toMatchObject({ t: "b", v: true });
  for (const address of Object.keys(sheet).filter(
    (key) => !key.startsWith("!"),
  )) {
    expect(sheet[address].f).toBeUndefined();
    expect(sheet[address].F).toBeUndefined();
    expect(sheet[address].l).toBeUndefined();
  }
  expect(
    workbook.keys.filter((key) => /xl\/worksheets\/sheet\d+\.xml$/.test(key)),
  ).toHaveLength(1);
  expect(
    workbook.keys.some((key) => /vba|macro|externalLinks/i.test(key)),
  ).toBe(false);
  const decoder = new TextDecoder();
  const xml = workbook.keys
    .filter((key) => /\.(xml|rels)$/i.test(key))
    .map((key) => {
      const content = workbook.files[key]?.content;
      return typeof content === "string" ? content : decoder.decode(content);
    })
    .join("\n");
  expect(xml).not.toMatch(/<f(?:\s|>)/i);
  expect(xml).not.toMatch(/<hyperlink(?:\s|>)/i);
  expect(xml).not.toMatch(/TargetMode=["']External["']/i);
  expect(xml).not.toMatch(
    /spreadsheetml\.(sheet|template)\.macroEnabled\.main\+xml|vbaProject/i,
  );
  expect(xml).not.toContain("�");
});

test("F12-B table fences and filenames are kind-specific", () => {
  const source = JSON.stringify(sampleTable());
  expect(
    artifactSource(
      [{ type: "text", text: `\`\`\`table\n${source}\n\`\`\`` }],
      "table",
    ),
  ).toBe(source);
  expect(
    artifactSource(
      [{ type: "text", text: `\`\`\`json\n${source}\n\`\`\`` }],
      "table",
    ),
  ).toBe(source);
  expect(tableExportFilename('../Unsafe "title"', 3, "xlsx")).toBe(
    "Unsafe-title-v3.xlsx",
  );
});
