"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  parseTableSource,
  type TableSpec,
  tableCellText,
  tableLimits,
} from "@/lib/artifacts/table-spec";

function TableValue({ value }: { value: string | number | boolean }) {
  if (value === "")
    return (
      <>
        <span className="sr-only">Empty text</span>
        <span aria-hidden="true" className="text-muted-foreground">
          —
        </span>
      </>
    );
  return <>{tableCellText(value)}</>;
}

export function TableDataTable({
  spec,
  page = 0,
}: {
  spec: TableSpec;
  page?: number;
}) {
  const start = page * tableLimits.previewRows;
  const rows = spec.rows.slice(start, start + tableLimits.previewRows);
  return (
    <section
      className="max-h-[32rem] overflow-auto rounded-lg border"
      // The scroll region must be keyboard-focusable when either axis overflows.
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus exposes native scrolling to keyboard users.
      tabIndex={0}
      aria-label={`${spec.title} data table`}
    >
      <table className="w-full min-w-max border-collapse text-left text-sm">
        <caption className="border-b bg-muted/40 p-3 text-left">
          <span className="block font-medium text-foreground">
            {spec.title}
          </span>
          <span className="block text-muted-foreground">
            {spec.description}
          </span>
        </caption>
        <thead>
          <tr className="border-b bg-muted/60">
            <th scope="col" className="p-3 font-medium">
              Row
            </th>
            {spec.columns.map((column, index) => (
              <th
                // Positional columns deliberately need no caller-provided key.
                key={`${index}-${column.label}`}
                scope="col"
                className="max-w-80 whitespace-normal break-words p-3 font-medium"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={`${start + rowIndex}-${row.label}`}
              className="border-b last:border-0"
            >
              <th
                scope="row"
                className="max-w-80 whitespace-normal break-words p-3 align-top font-medium"
              >
                {row.label}
              </th>
              {row.values.map((value, columnIndex) => (
                <td
                  // Cells are positional and the schema deliberately has no cell identifiers.
                  // biome-ignore lint/suspicious/noArrayIndexKey: the column index is the cell identity.
                  key={columnIndex}
                  className="max-w-96 whitespace-pre-wrap break-words p-3 align-top tabular-nums"
                >
                  <TableValue value={value} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function TablePreview({ source }: { source: string }) {
  const parsed = parseTableSource(source);
  const [previewState, setPreviewState] = useState({ source, page: 0 });
  if (previewState.source !== source) setPreviewState({ source, page: 0 });
  const page = previewState.source === source ? previewState.page : 0;
  if (!parsed.success)
    return (
      <p
        role="alert"
        className="rounded-lg border p-4 text-sm text-destructive"
      >
        {parsed.error}
      </p>
    );
  const pages = Math.ceil(parsed.data.rows.length / tableLimits.previewRows);
  const safePage = Math.min(page, pages - 1);
  const start = safePage * tableLimits.previewRows + 1;
  const end = Math.min(
    parsed.data.rows.length,
    (safePage + 1) * tableLimits.previewRows,
  );
  return (
    <section className="space-y-3" aria-label="Table preview">
      <TableDataTable spec={parsed.data} page={safePage} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <output aria-live="polite" className="text-sm text-muted-foreground">
          Rows {start.toLocaleString()}–{end.toLocaleString()} of{" "}
          {parsed.data.rows.length.toLocaleString()}
        </output>
        {pages > 1 && (
          <nav className="flex gap-2" aria-label="Table pages">
            <Button
              type="button"
              variant="outline"
              disabled={safePage === 0}
              onClick={() =>
                setPreviewState((current) => ({
                  ...current,
                  page: Math.max(0, current.page - 1),
                }))
              }
            >
              Previous rows
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={safePage >= pages - 1}
              onClick={() =>
                setPreviewState((current) => ({
                  ...current,
                  page: Math.min(pages - 1, current.page + 1),
                }))
              }
            >
              Next rows
            </Button>
          </nav>
        )}
      </div>
    </section>
  );
}
