import fs from "node:fs/promises";
import { DEFAULT_SPEC, type Metric } from "@storewhy/contracts";
import { ZetarisBackend } from "../apps/server/src/integrations/zetaris.ts";
import { Analytics } from "../apps/server/src/analytics/service.ts";
const manifest = JSON.parse(
  await fs.readFile("data/manifests/procrastinate.json", "utf8"),
);
const a = new Analytics(new ZetarisBackend(), manifest.version);
const evidence = await a.query(DEFAULT_SPEC);
const expected = [
  { spend: 15090.05, new_users: 15315, payers: 1227, revenue: 13645.59 },
  { spend: 16447.06, new_users: 14941, payers: 1195, revenue: 13688.12 },
];
for (let i = 0; i < 2; i++)
  for (const [key, value] of Object.entries(expected[i]))
    if (
      Math.abs(
        Number(evidence.rows[i].values[key as keyof (typeof expected)[0]]) -
          value,
      ) > 0.001
    )
      throw new Error("Reference mismatch " + key);
const reference = JSON.parse(
  await fs.readFile("evidence/reference-metrics.json", "utf8"),
);
function same(rows: typeof evidence.rows, expected: Record<string, number>[]) {
  for (let i = 0; i < expected.length; i++)
    for (const [metric, value] of Object.entries(expected[i]))
      if (
        !Number.isFinite(Number(rows[i]?.values[metric as Metric])) ||
        Math.abs(Number(rows[i]?.values[metric as Metric]) - value) > 0.00001
      )
        throw new Error("Independent reference mismatch: " + metric);
}
same(evidence.rows, reference.cohorts["14"]);
const h7 = await a.query({ ...DEFAULT_SPEC, windowDays: 7 });
same(h7.rows, reference.cohorts["7"]);
const grouped = await a.query({ ...DEFAULT_SPEC, groupBy: ["channel"] });
for (const p of DEFAULT_SPEC.periods) {
  const all = evidence.rows.find((r) => r.period === p.label)!;
  const rows = grouped.rows.filter((r) => r.period === p.label);
  for (const m of ["spend", "new_users", "revenue"] as const) {
    const total = rows.reduce((s, r) => s + (r.values[m] ?? 0), 0);
    if (Math.abs(total - all.values[m]!) > 0.02)
      throw new Error("Group reconciliation failed " + m);
  }
}
const device = await a.query({
  ...DEFAULT_SPEC,
  groupBy: ["device"],
  metrics: ["users", "payers", "revenue", "payer_rate"],
});
const calendar = await a.query({
  ...DEFAULT_SPEC,
  mode: "calendar",
  audience: "all",
  metrics: [
    "users",
    "purchases",
    "revenue",
    "first_purchase_revenue",
    "repeat_purchase_revenue",
    "avg_first_purchase_hours",
  ],
});
same(calendar.rows, reference.calendar);
const immature = await a.query({
  ...DEFAULT_SPEC,
  periods: [{ label: "2019-10", start: "2019-10-01", end: "2019-11-01" }],
});
const trend = await a.query({
  ...DEFAULT_SPEC,
  mode: "calendar",
  audience: "all",
  timeGrain: "month",
  metrics: [
    "users",
    "purchases",
    "revenue",
    "first_purchase_revenue",
    "repeat_purchase_revenue",
    "avg_first_purchase_hours",
  ],
});
if (
  JSON.stringify(trend.rows.map((r) => r.values)) !==
  JSON.stringify(calendar.rows.map((r) => r.values))
)
  throw new Error("Trend reconciliation failed");
await fs.mkdir("evidence", { recursive: true });
await fs.writeFile(
  "evidence/live-metrics.json",
  JSON.stringify(
    {
      checks: "PASS",
      baseline: evidence,
      h7,
      independentReference: "reference-metrics.json",
      grouped,
      device,
      calendar,
      immature,
      trend,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      result: "PASS",
      baseline: evidence.rows,
      queryCount: [
        evidence,
        h7,
        grouped,
        device,
        calendar,
        immature,
        trend,
      ].reduce((n, e) => n + e.queryIds.length, 0),
    },
    null,
    2,
  ),
);
