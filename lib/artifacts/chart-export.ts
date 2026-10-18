import {
  type ChartSpec,
  chartColors,
  chartDashes,
  chartDomain,
  chartTick,
  chartValue,
  parseChartSource,
  truncateChartText,
} from "./chart-spec";

const escapeXml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char] ?? char,
  );
const coordinate = (value: number) => String(Math.round(value * 1000) / 1000);

/** Serialize only fixed SVG primitives. Never accept markup, URLs or SVG props. */
export function chartSvg(source: string) {
  const result = parseChartSource(source);
  if (!result.success) return null;
  return renderSvg(result.data);
}

function renderSvg(spec: ChartSpec) {
  const left = 86,
    top = 110,
    width = 810,
    height = 360;
  const numericY =
    spec.type === "scatter"
      ? spec.rows.flatMap((row) =>
          row.values.flatMap((value) => (value ? [value.y] : [])),
        )
      : spec.rows.flatMap((row) =>
          row.values.filter((value): value is number => value !== null),
        );
  const yDomain = chartDomain(numericY);
  const numericX =
    spec.type === "scatter"
      ? spec.rows.flatMap((row) =>
          row.values.flatMap((value) => (value ? [value.x] : [])),
        )
      : [];
  const xDomain = chartDomain(numericX, false);
  const y = (value: number) =>
    top + height - ((value - yDomain[0]) / (yDomain[1] - yDomain[0])) * height;
  const x = (index: number) =>
    left + ((index + 0.5) * width) / spec.rows.length;
  const scatterX = (value: number) =>
    left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * width;
  const text = (
    xPos: number,
    yPos: number,
    value: string,
    anchor = "start",
    size = 14,
  ) =>
    `<text x="${coordinate(xPos)}" y="${coordinate(yPos)}" text-anchor="${anchor}" font-size="${size}">${escapeXml(value)}</text>`;
  const svg: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 680" role="img" aria-labelledby="chart-title chart-description">`,
    `<title id="chart-title">${escapeXml(spec.title)}</title><desc id="chart-description">${escapeXml(spec.description)} Missing values are gaps. Exact values are in the companion chart JSON.</desc>`,
    `<rect width="960" height="680" fill="#ffffff"/><g fill="#182235" font-family="system-ui, sans-serif">`,
    text(32, 38, chartTickTitle(spec.title), "start", 22),
    text(32, 68, chartTickTitle(spec.description, 108), "start", 13),
  ];
  for (let i = 0; i <= 4; i++) {
    const value = yDomain[0] + ((yDomain[1] - yDomain[0]) * i) / 4;
    const yPos = y(value);
    svg.push(
      `<line x1="${left}" x2="${left + width}" y1="${coordinate(yPos)}" y2="${coordinate(yPos)}" stroke="#d5dae3"/>`,
      text(left - 10, yPos + 4, chartTick(chartValue(value)), "end", 12),
    );
  }
  svg.push(
    `<line x1="${left}" x2="${left + width}" y1="${coordinate(y(0))}" y2="${coordinate(y(0))}" stroke="#64748b"/>`,
  );
  if (spec.type === "scatter") {
    for (let i = 0; i <= 4; i++) {
      const value = xDomain[0] + ((xDomain[1] - xDomain[0]) * i) / 4;
      svg.push(
        text(
          scatterX(value),
          top + height + 22,
          chartTick(chartValue(value)),
          "middle",
          12,
        ),
      );
    }
    spec.series.forEach((_, seriesIndex) => {
      for (const row of spec.rows) {
        const value = row.values[seriesIndex];
        if (value) {
          const cx = scatterX(value.x),
            cy = y(value.y);
          // A series number provides a non-color cue in scatter exports.
          svg.push(
            `<circle cx="${coordinate(cx)}" cy="${coordinate(cy)}" r="9" fill="${chartColors[seriesIndex]}"/>`,
            `<g fill="#ffffff">${text(cx, cy + 4, String(seriesIndex + 1), "middle", 11)}</g>`,
          );
        }
      }
    });
  } else {
    const step = Math.max(1, Math.ceil(spec.rows.length / 8));
    spec.rows.forEach((row, index) => {
      if (index % step === 0)
        svg.push(
          text(x(index), top + height + 22, chartTick(row.label), "middle", 12),
        );
    });
    spec.series.forEach((_, seriesIndex) => {
      const color = chartColors[seriesIndex];
      if (spec.type === "bar") {
        const groupWidth = (width / spec.rows.length) * 0.8;
        const barWidth = groupWidth / spec.series.length;
        spec.rows.forEach((row, index) => {
          const value = row.values[seriesIndex];
          if (value === null) return;
          svg.push(
            `<rect x="${coordinate(x(index) - groupWidth / 2 + seriesIndex * barWidth)}" y="${coordinate(Math.min(y(0), y(value)))}" width="${coordinate(barWidth)}" height="${coordinate(Math.abs(y(value) - y(0)))}" fill="${color}"/>`,
          );
        });
      } else {
        let segment: Array<[number, number]> = [];
        const flush = () => {
          if (!segment.length) return;
          const line = segment
            .map(
              ([xPos, yPos], index) =>
                `${index ? "L" : "M"}${coordinate(xPos)},${coordinate(yPos)}`,
            )
            .join(" ");
          if (spec.type === "area")
            svg.push(
              `<path d="${line} L${coordinate(segment[segment.length - 1][0])},${coordinate(y(0))} L${coordinate(segment[0][0])},${coordinate(y(0))} Z" fill="${color}" fill-opacity="0.16"/>`,
            );
          svg.push(
            `<path d="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="${chartDashes[seriesIndex]}"/>`,
          );
          for (const [xPos, yPos] of segment)
            svg.push(
              `<circle cx="${coordinate(xPos)}" cy="${coordinate(yPos)}" r="3" fill="${color}"/>`,
            );
          segment = [];
        };
        spec.rows.forEach((row, index) => {
          const value = row.values[seriesIndex];
          if (value === null) flush();
          else segment.push([x(index), y(value)]);
        });
        flush();
      }
    });
  }
  svg.push(
    text(left + width / 2, 533, spec.xAxis.label, "middle"),
    text(left, 96, spec.yAxis.label, "start", 13),
  );
  spec.series.forEach((series, index) => {
    const xPos = 32 + (index % 2) * 460,
      yPos = 575 + Math.floor(index / 2) * 26;
    svg.push(
      `<rect x="${xPos}" y="${yPos - 11}" width="12" height="12" fill="${chartColors[index]}"/>`,
      text(
        xPos + 20,
        yPos,
        `${index + 1}. ${chartTickTitle(series.label, 44)}`,
        "start",
        13,
      ),
    );
  });
  svg.push("</g></svg>");
  return svg.join("");
}
function chartTickTitle(value: string, length = 76) {
  return truncateChartText(value, length);
}
