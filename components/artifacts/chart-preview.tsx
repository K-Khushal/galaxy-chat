"use client";

import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type ChartSpec,
  chartColors,
  chartDashes,
  chartDomain,
  chartTick,
  chartValue,
  parseChartSource,
} from "@/lib/artifacts/chart-spec";

export function ChartPreview({ source }: { source: string }) {
  const result = useMemo(() => parseChartSource(source), [source]);
  if (!result.success)
    return (
      <p
        role="alert"
        className="rounded-md border p-4 text-sm text-destructive"
      >
        {result.error}
      </p>
    );
  return <ValidChart spec={result.data} />;
}

function ValidChart({ spec }: { spec: ChartSpec }) {
  const uid = useId();
  const titleId = `${uid}-chart-title`,
    descriptionId = `${uid}-chart-description`;
  // Positions are the identities in the chart contract, never input labels/paths.
  const series = spec.series.map((item, index) => ({
    ...item,
    index,
    key: `s${index}`,
  }));
  const config: ChartConfig = Object.fromEntries(
    spec.series.map((series, index) => [
      `s${index}`,
      { label: series.label, color: chartColors[index] },
    ]),
  );
  const categoryData =
    spec.type === "scatter"
      ? []
      : spec.rows.map((row, rowIndex) => ({
          rowIndex,
          label: row.label,
          ...Object.fromEntries(
            row.values.map((value, index) => [`s${index}`, value]),
          ),
        }));
  const scatterData =
    spec.type === "scatter"
      ? spec.series.map((_, index) =>
          spec.rows.flatMap((row) => {
            const value = row.values[index];
            return value ? [{ x: value.x, y: value.y }] : [];
          }),
        )
      : [];
  const yValues =
    spec.type === "scatter"
      ? scatterData.flatMap((series) => series.map((value) => value.y))
      : spec.rows.flatMap((row) =>
          row.values.filter((value): value is number => value !== null),
        );
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis
        dataKey="label"
        tickFormatter={chartTick}
        tickLine={false}
        axisLine={false}
        interval="preserveStartEnd"
        minTickGap={20}
      />
      <YAxis
        domain={chartDomain(yValues)}
        tickFormatter={chartTick}
        tickLine={false}
        axisLine={false}
        width={66}
      />
    </>
  );
  const margin = { top: 12, right: 16, bottom: 12, left: 0 };
  const colors = (index: number) => ({
    stroke: chartColors[index],
    fill: chartColors[index],
  });
  const chart =
    spec.type === "bar" ? (
      <BarChart data={categoryData} margin={margin}>
        {axes}
        {series.map(({ key, index }) => (
          <Bar
            key={key}
            dataKey={key}
            {...colors(index)}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    ) : spec.type === "line" ? (
      <LineChart data={categoryData} margin={margin}>
        {axes}
        {series.map(({ key, index }) => (
          <Line
            key={key}
            dataKey={key}
            type="linear"
            strokeWidth={2}
            {...colors(index)}
            fill="none"
            strokeDasharray={chartDashes[index]}
            isAnimationActive={false}
            connectNulls={false}
            dot={categoryData.length <= 80}
          />
        ))}
      </LineChart>
    ) : spec.type === "area" ? (
      <AreaChart data={categoryData} margin={margin}>
        {axes}
        {series.map(({ key, index }) => (
          <Area
            key={key}
            dataKey={key}
            type="linear"
            strokeWidth={2}
            {...colors(index)}
            fillOpacity={0.16}
            strokeDasharray={chartDashes[index]}
            isAnimationActive={false}
            connectNulls={false}
            dot={categoryData.length <= 80}
            baseValue={0}
          />
        ))}
      </AreaChart>
    ) : (
      <ScatterChart margin={margin}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="x"
          type="number"
          domain={chartDomain(
            scatterData.flatMap((series) => series.map((value) => value.x)),
            false,
          )}
          tickFormatter={chartTick}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          dataKey="y"
          type="number"
          domain={chartDomain(yValues)}
          tickFormatter={chartTick}
          tickLine={false}
          axisLine={false}
          width={66}
        />
        {series.map(({ key, index }) => (
          <Scatter
            key={key}
            data={scatterData[index]}
            {...colors(index)}
            shape={
              (
                [
                  "circle",
                  "diamond",
                  "square",
                  "triangle",
                  "cross",
                  "star",
                  "wye",
                  "circle",
                ] as const
              )[index]
            }
            isAnimationActive={false}
          />
        ))}
      </ScatterChart>
    );
  return (
    <section
      className="min-w-0 space-y-4 rounded-lg border bg-card p-3 sm:p-4"
      aria-labelledby={titleId}
    >
      <div className="space-y-1 [overflow-wrap:anywhere]">
        <h3 id={titleId} className="text-lg font-semibold">
          {spec.title}
        </h3>
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {spec.description}
        </p>
      </div>
      <figure
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="m-0 min-w-0"
      >
        <p className="mb-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {spec.yAxis.label}
        </p>
        <div aria-hidden="true">
          <ChartContainer
            config={config}
            className="h-72 min-h-72 w-full aspect-auto [&_.recharts-cartesian-axis-tick_text]:text-[11px] dark:[&_.recharts-surface]:brightness-125"
          >
            {chart}
          </ChartContainer>
        </div>
        <figcaption className="text-center text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {spec.xAxis.label}
        </figcaption>
      </figure>
      <ol
        aria-label="Chart series"
        className="flex list-inside list-decimal flex-wrap gap-x-5 gap-y-2 text-sm [overflow-wrap:anywhere]"
      >
        {series.map(({ key, index, label }) => (
          <li key={key}>
            <span
              aria-hidden="true"
              className="mr-1 inline-block size-2.5 rounded-sm border"
              style={{ backgroundColor: chartColors[index] }}
            />
            {label}
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        Missing values are gaps, not zero. Full labels and exact values appear
        in the table.
      </p>
      <ChartDataTable spec={spec} />
    </section>
  );
}

export function ChartDataTable({ spec }: { spec: ChartSpec }) {
  const uid = useId();
  const columns = spec.series.flatMap((series, index) =>
    spec.type === "scatter"
      ? [
          {
            key: `s${index}-x`,
            label: `${index + 1}. ${series.label}: ${spec.xAxis.label}`,
          },
          {
            key: `s${index}-y`,
            label: `${index + 1}. ${series.label}: ${spec.yAxis.label}`,
          },
        ]
      : [
          {
            key: `s${index}`,
            label: `${index + 1}. ${series.label} (${spec.yAxis.label})`,
          },
        ],
  );
  const rows =
    spec.type === "scatter"
      ? spec.rows.map((row, index) => ({
          key: `r${index}`,
          label: row.label,
          cells: row.values.flatMap((value, seriesIndex) => [
            { key: `s${seriesIndex}-x`, value: chartValue(value?.x ?? null) },
            { key: `s${seriesIndex}-y`, value: chartValue(value?.y ?? null) },
          ]),
        }))
      : spec.rows.map((row, index) => ({
          key: `r${index}`,
          label: row.label,
          cells: row.values.map((value, seriesIndex) => ({
            key: `s${seriesIndex}`,
            value: chartValue(value),
          })),
        }));
  return (
    <section
      aria-labelledby={`${uid}-table-caption`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll this bounded data region.
      tabIndex={0}
      className="max-h-80 min-w-0 overflow-auto rounded-md border focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Table>
        <TableCaption
          id={`${uid}-table-caption`}
          className="caption-top px-3 py-2 text-left"
        >
          {spec.title} — data table
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="max-w-60 whitespace-normal">
              {spec.type === "scatter" ? "Point" : spec.xAxis.label}
            </TableHead>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                scope="col"
                className="max-w-60 whitespace-normal [overflow-wrap:anywhere]"
              >
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableHead
                scope="row"
                className="max-w-60 whitespace-normal [overflow-wrap:anywhere]"
              >
                {row.label}
              </TableHead>
              {row.cells.map((cell) => (
                <TableCell key={cell.key}>{cell.value}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
