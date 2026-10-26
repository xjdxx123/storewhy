import { isDeepStrictEqual } from "node:util";
import {
  CHART_VERSION,
  chartSchema,
  type Chart,
  type ChartPoint,
  type ChartResponse,
  type ChartUnit,
  type Evidence,
  type Metric,
  type AnalysisRow,
} from "@storewhy/contracts";
import { LABELS } from "./catalog.ts";
import { AppError } from "../config.ts";

const UNITS: Record<Metric, ChartUnit> = {
  spend: "sample_amount",
  sessions: "count",
  users: "count",
  new_users: "count",
  payers: "count",
  purchases: "count",
  revenue: "sample_amount",
  first_purchase_revenue: "sample_amount",
  repeat_purchase_revenue: "sample_amount",
  payer_rate: "proportion",
  revenue_per_user: "sample_amount_per_user",
  revenue_per_payer: "sample_amount_per_payer",
  repeat_payer_rate: "proportion",
  cost_per_new_user: "sample_amount_per_user",
  revenue_to_spend: "multiple",
  avg_first_purchase_hours: "hours",
};
const UNIT_LABELS: Record<ChartUnit, string> = {
  sample_amount: "Sample amount (currency unspecified)",
  count: "Count",
  proportion: "Proportion (raw value 0–1)",
  multiple: "Multiple",
  hours: "Hours",
  sample_amount_per_user: "Sample amount / user",
  sample_amount_per_payer: "Sample amount / purchaser",
};
const COMPONENTS: Metric[] = [
  "first_purchase_revenue",
  "repeat_purchase_revenue",
];
const dimKey = (row: AnalysisRow) =>
  ["channel", "device", "region"].map(
    (d) => row.dimensions[d as keyof AnalysisRow["dimensions"]] ?? null,
  );
const dimLabel = (row: AnalysisRow) =>
  ["channel", "device", "region"]
    .map((d) => row.dimensions[d as keyof AnalysisRow["dimensions"]])
    .filter(Boolean)
    .join(" / ") || "Overall";
function pointKey(type: Chart["type"], row: AnalysisRow) {
  return JSON.stringify(
    type === "line"
      ? [row.bucket]
      : type === "stacked_bar"
        ? [row.period, ...dimKey(row)]
        : dimKey(row),
  );
}
function pointLabel(type: Chart["type"], row: AnalysisRow) {
  return type === "line"
    ? row.bucket!
    : type === "stacked_bar"
      ? `${row.period} / ${dimLabel(row)}`
      : dimLabel(row);
}
function titleFor(e: Evidence, type: Chart["type"], metric: Metric) {
  const mode =
    e.spec.mode === "cohort"
      ? `First ${e.spec.windowDays} days after first visit`
      : "Calendar period";
  return `${mode} · ${type === "stacked_bar" ? "First and subsequent purchase revenue" : LABELS[metric]}`;
}
function xLabelFor(e: Evidence, type: Chart["type"]) {
  return type === "line"
    ? "Date (source timestamps)"
    : type === "stacked_bar"
      ? "Period / segment"
      : e.spec.groupBy.length
        ? e.spec.groupBy.join(" / ")
        : "Overall";
}
function sourceFor(e: Evidence) {
  return {
    evidenceId: e.id,
    datasetVersion: e.datasetVersion,
    metricVersion: e.metricVersion,
    backend: e.backend,
    createdAt: e.createdAt,
    spec: structuredClone(e.spec),
    coverage: structuredClone(e.coverage),
    definitions: structuredClone(e.definitions),
  };
}
function pointFor(
  e: Evidence,
  type: Chart["type"],
  rowIndex: number,
  metric: Metric,
): ChartPoint {
  const row = e.rows[rowIndex];
  return {
    key: pointKey(type, row),
    label: pointLabel(type, row),
    period: row.period,
    ...(row.bucket ? { bucket: row.bucket } : {}),
    dimensions: { ...row.dimensions },
    value: row.values[metric]!,
    source: { evidenceId: e.id, rowIndex, metric },
  };
}

/** Validate semantic provenance as well as the public wire schema. */
export function validateChart(input: unknown, e: Evidence): Chart {
  const c = chartSchema.parse(input);
  const fail = () => {
    throw new AppError(
      "CHART_EVIDENCE_MISMATCH",
      "The chart does not match its source query evidence",
      500,
    );
  };
  if (
    e.truncated ||
    !e.rows.length ||
    !isDeepStrictEqual(c.source, sourceFor(e))
  )
    fail();
  const metrics = [...new Set(c.series.map((s) => s.metric))];
  if (
    metrics.some((m) => !e.spec.metrics.includes(m) || !e.definitions[m]) ||
    metrics.some((m) => UNITS[m] !== c.yAxis.unit) ||
    c.yAxis.label !== UNIT_LABELS[c.yAxis.unit] ||
    c.xAxis.kind !== (c.type === "line" ? "time" : "category") ||
    (c.type === "line"
      ? e.spec.mode !== "calendar" ||
        !e.spec.timeGrain ||
        e.rows.some((r) => !r.bucket)
      : Boolean(e.spec.timeGrain)) ||
    (c.type === "stacked_bar"
      ? metrics.length !== 2 || COMPONENTS.some((m) => !metrics.includes(m))
      : metrics.length !== 1)
  )
    fail();
  if (
    c.title !==
      titleFor(
        e,
        c.type,
        c.type === "stacked_bar" ? "first_purchase_revenue" : metrics[0],
      ) ||
    c.xAxis.label !== xLabelFor(e, c.type)
  )
    fail();
  const seenSeries = new Set<string>();
  const seenRows = new Map<Metric, Set<number>>();
  for (const s of c.series) {
    if (seenSeries.has(s.id)) fail();
    seenSeries.add(s.id);
    if (
      c.type === "stacked_bar"
        ? s.period !== undefined || s.dimensions !== undefined
        : !e.spec.periods.some((p) => p.label === s.period) ||
          (c.type === "line"
            ? s.dimensions === undefined
            : s.dimensions !== undefined)
    )
      fail();
    const firstRow = e.rows[s.points[0].source.rowIndex];
    if (
      !firstRow ||
      s.label !==
        (c.type === "stacked_bar"
          ? LABELS[s.metric]
          : c.type === "line"
            ? `${s.period} / ${dimLabel(firstRow)}`
            : s.period)
    )
      fail();
    const seenKeys = new Set<string>();
    for (const p of s.points) {
      const ref = p.source;
      const row = e.rows[ref.rowIndex];
      let seen = seenRows.get(s.metric);
      if (!seen) {
        seen = new Set();
        seenRows.set(s.metric, seen);
      }
      if (
        !row ||
        ref.evidenceId !== e.id ||
        ref.metric !== s.metric ||
        !Object.hasOwn(row.values, s.metric) ||
        row.values[s.metric] !== p.value ||
        p.period !== row.period ||
        p.bucket !== row.bucket ||
        !isDeepStrictEqual(p.dimensions, row.dimensions) ||
        p.key !== pointKey(c.type, row) ||
        p.label !== pointLabel(c.type, row) ||
        (s.period !== undefined && s.period !== row.period) ||
        (s.dimensions !== undefined &&
          !isDeepStrictEqual(s.dimensions, row.dimensions)) ||
        seen.has(ref.rowIndex) ||
        seenKeys.has(p.key)
      )
        fail();
      seen.add(ref.rowIndex);
      seenKeys.add(p.key);
    }
  }
  // A chart represents every returned source row for each plotted metric.
  // It never silently drops a channel, null value or time bucket.
  if (metrics.some((m) => seenRows.get(m)?.size !== e.rows.length)) fail();
  return c;
}

function makeChart(e: Evidence, type: Chart["type"], metric: Metric): Chart {
  const metrics = type === "stacked_bar" ? COMPONENTS : [metric];
  const series: Chart["series"] = [];
  if (type === "stacked_bar") {
    for (const m of metrics)
      series.push({
        id: m,
        label: LABELS[m],
        metric: m,
        points: e.rows.map((_row, i) => pointFor(e, type, i, m)),
      });
  } else {
    const groups = new Map<string, number[]>();
    e.rows.forEach((row, i) => {
      const key = JSON.stringify([
        row.period,
        ...(type === "line" ? dimKey(row) : []),
      ]);
      const indexes = groups.get(key) ?? [];
      indexes.push(i);
      groups.set(key, indexes);
    });
    for (const indexes of groups.values()) {
      const row = e.rows[indexes[0]];
      if (type === "line")
        indexes.sort((a, b) =>
          e.rows[a].bucket!.localeCompare(e.rows[b].bucket!),
        );
      series.push({
        id: `s-${series.length}`,
        label:
          type === "line" ? `${row.period} / ${dimLabel(row)}` : row.period,
        metric,
        period: row.period,
        ...(type === "line" ? { dimensions: { ...row.dimensions } } : {}),
        points: indexes.map((i) => pointFor(e, type, i, metric)),
      });
    }
  }
  return validateChart(
    {
      id: `chart-${e.id}-${type}-${type === "stacked_bar" ? "purchase-revenue" : metric}`,
      version: CHART_VERSION,
      type,
      title: titleFor(e, type, metric),
      xAxis: {
        label: xLabelFor(e, type),
        kind: type === "line" ? "time" : "category",
      },
      yAxis: {
        label: UNIT_LABELS[UNITS[metric]],
        unit: UNITS[metric],
        zeroBaseline: true,
      },
      missingValues: "gap",
      source: sourceFor(e),
      series,
      notes: [
        ...e.notes.filter((note) => !note.startsWith("spec:")),
        "Charts show observed query results. See the answer for explanations and review status.",
        "Missing values are not filled with zero. Lines break across missing time buckets.",
      ],
    },
    e,
  );
}

/** Deterministic presentation only: no model calls, new SQL, aggregation or top-N. */
export function chartsFor(evidence: Evidence[]): ChartResponse {
  const charts: Chart[] = [],
    notes: string[] = [];
  const seen = new Set<string>();
  for (const e of [...evidence].reverse()) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (e.truncated || !e.rows.length) {
      notes.push(
        `${e.id}: ${e.truncated ? "The result was truncated, so no chart was generated. Narrow the scope and query again." : "No results; no chart generated."}`,
      );
      continue;
    }
    if (charts.length >= 2) continue;
    const available = (m: Metric) =>
      e.spec.metrics.includes(m) &&
      Boolean(e.definitions[m]) &&
      e.rows.every(
        (r) =>
          Object.hasOwn(r.values, m) &&
          (r.values[m] === null || Number.isFinite(r.values[m])),
      ) &&
      e.rows.some((r) => r.values[m] !== null);
    const metrics = [
      ...new Set<Metric>(["spend", "revenue", ...e.spec.metrics]),
    ].filter(available);
    if (!metrics.length) {
      notes.push(
        `${e.id}: No queried values can be plotted; no chart generated.`,
      );
      continue;
    }
    if (e.spec.timeGrain) {
      const groupCount = new Set(
        e.rows.map((r) => JSON.stringify([r.period, ...dimKey(r)])),
      ).size;
      if (
        e.spec.mode !== "calendar" ||
        e.rows.some((r) => !r.bucket) ||
        groupCount > 64
      ) {
        notes.push(
          `${e.id}: Missing time buckets or too many series. Narrow the scope and query again.`,
        );
        continue;
      }
    } else if (COMPONENTS.every(available)) {
      charts.push(makeChart(e, "stacked_bar", "first_purchase_revenue"));
    }
    for (const metric of metrics) {
      if (charts.length >= 2) break;
      if (
        !e.spec.timeGrain &&
        COMPONENTS.every(available) &&
        [...COMPONENTS, "revenue"].includes(metric)
      )
        continue;
      charts.push(makeChart(e, e.spec.timeGrain ? "line" : "bar", metric));
    }
  }
  return { charts, notes };
}
