import { type TableCell, type TableSpec, tableCellText } from "./table-spec";

const formulaPrefix = /^[=+\-@＝＋－＠]/u;
const hiddenPrefix = /^[\p{White_Space}\p{Cc}\p{Cf}]*/u;

export function neutralizeCsvText(value: string) {
  const visible = value.slice(value.match(hiddenPrefix)?.[0].length ?? 0);
  return formulaPrefix.test(visible) ? `\t${value}` : value;
}

function quote(value: string) {
  return `"${neutralizeCsvText(value).replaceAll('"', '""')}"`;
}

function csvCell(value: TableCell) {
  if (typeof value === "string") return quote(value);
  return typeof value === "boolean"
    ? tableCellText(value).toUpperCase()
    : String(value);
}

export function tableCsv(spec: TableSpec) {
  const lines = [
    [quote("Row"), ...spec.columns.map((column) => quote(column.label))].join(
      ",",
    ),
    ...spec.rows.map((row) =>
      [quote(row.label), ...row.values.map(csvCell)].join(","),
    ),
  ];
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}
