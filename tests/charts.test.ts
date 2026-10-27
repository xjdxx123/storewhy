import { afterAll, beforeAll, expect, it } from "vitest";
import {
  DEFAULT_SPEC,
  chartResponseSchema,
  chartSchema,
  type Chart,
  type Evidence,
} from "@storewhy/contracts";
import { FixtureBackend } from "../apps/server/src/integrations/fixture.ts";
import { Analytics } from "../apps/server/src/analytics/service.ts";
import {
  chartsFor,
  validateChart,
} from "../apps/server/src/analytics/charts.ts";
let backend: FixtureBackend, analytics: Analytics, grouped: Evidence;
beforeAll(async () => {
  backend = new FixtureBackend();
  await backend.initialize();
  analytics = new Analytics(backend, "charts-fixture");
  grouped = await analytics.query({ ...DEFAULT_SPEC, groupBy: ["channel"] });
});
afterAll(async () => backend.close());

it("binds every comparison bar to the exact source cell and complete scope", () => {
  const response = chartsFor([grouped]);
  expect(chartResponseSchema.safeParse(response).success).toBe(true);
  expect(response.charts).toHaveLength(2);
  expect(response.charts.map((c) => c.series[0].metric)).toEqual([
    "spend",
    "revenue",
  ]);
  for (const chart of response.charts) {
    expect(chart.source.spec).toEqual(grouped.spec);
    expect(chart.source.coverage).toEqual(grouped.coverage);
    expect(chart.yAxis.unit).toBe("sample_amount");
    expect(chart.series).toHaveLength(2);
    for (const point of chart.series.flatMap((s) => s.points)) {
      const row = grouped.rows[point.source.rowIndex];
      expect(point.source.evidenceId).toBe(grouped.id);
      expect(point.value).toBe(row.values[point.source.metric]);
      expect(point.dimensions).toEqual(row.dimensions);
      expect(point.period).toBe(row.period);
    }
    expect(validateChart(chart, grouped)).toEqual(chart);
  }
  // Mapping and sorting must not mutate an Evidence cached or shown elsewhere.
  const original = structuredClone(grouped);
  response.charts[0].source.spec.filters.channels.push("organic");
  expect(grouped).toEqual(original);
});

it("preserves missing costs as null and never gives organic a zero cost", async () => {
  const e = await analytics.query({
    ...DEFAULT_SPEC,
    audience: "all",
    groupBy: ["channel"],
  });
  const chart = chartsFor([e]).charts.find(
    (c) => c.series[0].metric === "spend",
  )!;
  const points = chart.series.flatMap((s) => s.points);
  expect(
    points.filter((p) => p.dimensions.channel === "organic").length,
  ).toBeGreaterThan(0);
  expect(
    points
      .filter((p) => p.dimensions.channel === "organic")
      .every((p) => p.value === null),
  ).toBe(true);
  expect(chart.missingValues).toBe("gap");
});

it("renders only queried metrics and retains proportion units without multiplying by 100", async () => {
  const e = await analytics.query({
    ...DEFAULT_SPEC,
    groupBy: ["device"],
    metrics: ["payer_rate"],
  });
  const chart = chartsFor([e]).charts[0];
  expect(chart.yAxis.unit).toBe("proportion");
  expect(chart.series.every((s) => s.metric === "payer_rate")).toBe(true);
  expect(
    chart.series
      .flatMap((s) => s.points)
      .every((p) => p.value === null || p.value <= 1),
  ).toBe(true);
  expect(
    chart.series
      .flatMap((s) => s.points)
      .every((p) => !Object.hasOwn(e.rows[p.source.rowIndex].values, "spend")),
  ).toBe(true);
});

it("uses only actual time buckets and separates channel series in a line chart", async () => {
  const e = await analytics.query({
    ...DEFAULT_SPEC,
    mode: "calendar",
    timeGrain: "day",
    groupBy: ["channel"],
    periods: [DEFAULT_SPEC.periods[0]],
    metrics: ["revenue"],
  });
  const chart = chartsFor([e]).charts[0];
  expect(chart.type).toBe("line");
  expect(chart.xAxis.kind).toBe("time");
  expect(chart.series.length).toBeGreaterThan(1);
  expect(chart.series.flatMap((s) => s.points)).toHaveLength(e.rows.length);
  for (const series of chart.series) {
    expect(
      series.points.every(
        (p) =>
          JSON.stringify(p.dimensions) === JSON.stringify(series.dimensions),
      ),
    ).toBe(true);
    const buckets = series.points.map((p) => p.bucket!);
    expect(buckets).toEqual([...buckets].sort());
    for (const p of series.points)
      expect(p.bucket).toBe(e.rows[p.source.rowIndex].bucket);
  }
});

it("does not infer a daily trend from two aggregate monthly values", () => {
  expect(chartsFor([grouped]).charts.every((c) => c.type === "bar")).toBe(true);
  const bad = structuredClone(grouped);
  bad.spec.timeGrain = "day";
  const response = chartsFor([bad]);
  expect(response.charts).toEqual([]);
  expect(response.notes.join()).toContain("time buckets");
});

it("stacks only queried first/subsequent revenue cells without counting total revenue twice", async () => {
  const e = await analytics.query({
    ...DEFAULT_SPEC,
    metrics: ["revenue", "first_purchase_revenue", "repeat_purchase_revenue"],
  });
  const charts = chartsFor([e]).charts;
  expect(charts).toHaveLength(1);
  const c = charts[0];
  expect(c.type).toBe("stacked_bar");
  expect(c.series.map((s) => s.metric)).toEqual([
    "first_purchase_revenue",
    "repeat_purchase_revenue",
  ]);
  expect(c.series.every((s) => s.period === undefined)).toBe(true);
  for (let i = 0; i < e.rows.length; i++) {
    expect(c.series[0].points[i].key).toBe(c.series[1].points[i].key);
    expect(c.series.reduce((n, s) => n + s.points[i].value!, 0)).toBe(
      e.rows[i].values.revenue,
    );
  }
});

it("omits truncated, empty and entirely null results with an explicit reason", () => {
  for (const [e, reason] of [
    [{ ...grouped, truncated: true }, "truncated"],
    [{ ...grouped, rows: [] }, "No result"],
    [
      {
        ...grouped,
        rows: grouped.rows.map((r) => ({
          ...r,
          values: Object.fromEntries(
            Object.keys(r.values).map((k) => [k, null]),
          ),
        })),
      },
      "No queried values",
    ],
  ] satisfies [Evidence, string][]) {
    const response = chartsFor([e]);
    expect(response.charts).toEqual([]);
    expect(response.notes.join()).toContain(reason);
  }
});

it("prioritizes newly gathered evidence and never mixes scopes in a chart", () => {
  const prior = { ...grouped, id: "prior" };
  const fresh = structuredClone(grouped);
  fresh.id = "fresh";
  const response = chartsFor([prior, fresh]);
  expect(response.charts).toHaveLength(2);
  expect(response.charts.every((c) => c.source.evidenceId === "fresh")).toBe(
    true,
  );
  expect(
    response.charts.every((c) =>
      c.series
        .flatMap((s) => s.points)
        .every((p) => p.source.evidenceId === "fresh"),
    ),
  ).toBe(true);
});

it.each<[string, (chart: Chart) => void]>([
  [
    "title",
    (c) => {
      c.title = "wrong result";
    },
  ],
  [
    "series label",
    (c) => {
      c.series[0].label = "wrong period";
    },
  ],
  [
    "value",
    (c) => {
      c.series[0].points[0].value = 999999;
    },
  ],
  [
    "row reference",
    (c) => {
      c.series[0].points[0].source.rowIndex = 99999;
    },
  ],
  [
    "evidence reference",
    (c) => {
      c.series[0].points[0].source.evidenceId = "old";
    },
  ],
  [
    "metric reference",
    (c) => {
      c.series[0].points[0].source.metric = "payers";
    },
  ],
  [
    "scope",
    (c) => {
      c.source.spec.windowDays = 7;
    },
  ],
  [
    "data version",
    (c) => {
      c.source.datasetVersion = "old";
    },
  ],
  [
    "dimensions",
    (c) => {
      c.series[0].points[0].dimensions.channel = "organic";
    },
  ],
  [
    "point label",
    (c) => {
      c.series[0].points[0].label = "wrong channel";
    },
  ],
  [
    "period",
    (c) => {
      c.series[0].points[0].period = "old month";
    },
  ],
  [
    "unit",
    (c) => {
      c.yAxis.unit = "proportion";
    },
  ],
  [
    "missing channel",
    (c) => {
      c.series[0].points.pop();
    },
  ],
  [
    "duplicate series",
    (c) => {
      c.series.push(structuredClone(c.series[0]));
    },
  ],
])(
  "rejects tampered %s instead of displaying unbound evidence",
  (_name, change) => {
    const c = chartsFor([grouped]).charts[0];
    change(c);
    expect(() => validateChart(c, grouped)).toThrow();
  },
);

it("rejects arbitrary rendering code and non-finite values at the wire boundary", () => {
  const c = chartsFor([grouped]).charts[0];
  expect(chartSchema.safeParse({ ...c, html: "<script>" }).success).toBe(false);
  c.series[0].points[0].value = Infinity;
  expect(chartSchema.safeParse(c).success).toBe(false);
});

it("keeps committed UI mock payloads valid and bound to their embedded fixture evidence", async () => {
  const fs = await import("node:fs/promises");
  const payload = JSON.parse(
    await fs.readFile("docs/examples/charts.json", "utf8"),
  );
  expect(payload.examples).toHaveLength(3);
  const types = new Set<string>();
  for (const example of payload.examples) {
    const response = chartResponseSchema.parse(example.response);
    expect(example.evidence.backend).toBe("fixture");
    for (const chart of response.charts) {
      validateChart(chart, example.evidence);
      types.add(chart.type);
    }
  }
  expect([...types].sort()).toEqual(["bar", "line", "stacked_bar"]);
});
