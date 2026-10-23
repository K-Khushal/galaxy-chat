import "server-only";
import * as XLSX from "xlsx";
import type { TableCell, TableSpec } from "./table-spec";

function xlsxCell(value: TableCell): XLSX.CellObject {
  if (typeof value === "string") return { t: "s", v: value };
  if (typeof value === "number") return { t: "n", v: value };
  return { t: "b", v: value };
}

export function tableXlsx(spec: TableSpec) {
  const data: XLSX.CellObject[][] = [
    [
      { t: "s", v: "Row" },
      ...spec.columns.map((column) => ({ t: "s" as const, v: column.label })),
    ],
    ...spec.rows.map((row) => [
      { t: "s" as const, v: row.label },
      ...row.values.map(xlsxCell),
    ]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Table");
  const output: Uint8Array = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
    compression: true,
  });
  return new Uint8Array(output);
}
