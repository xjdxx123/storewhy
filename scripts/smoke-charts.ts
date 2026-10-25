import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  DEFAULT_SPEC,
  chartResponseSchema,
  type Chart,
  type Evidence,
  type Run,
} from "@storewhy/contracts";
import { StoreWhyClient } from "@storewhy/contracts/client";
const url = process.env.STOREWHY_HTTP_URL ?? "http://127.0.0.1:3100";
const api = new StoreWhyClient(url);
const health = await (await fetch(url + "/healthz")).json();
assert.equal(health.dataMode, "zetaris");
assert.equal(health.apiVersion, "1.1.0");
const cache = new Map<string, Evidence>();
async function checkChart(c: Chart) {
  let e = cache.get(c.source.evidenceId);
  if (!e) {
    e = await api.evidence(c.source.evidenceId);
    cache.set(e.id, e);
  }
  assert.equal(e.backend, "zetaris");
  assert.equal(e.truncated, false);
  assert.equal(c.source.datasetVersion, e.datasetVersion);
  assert.deepEqual(c.source.spec, e.spec);
  assert.deepEqual(c.source.coverage, e.coverage);
  for (const series of c.series) {
    for (const p of series.points) {
      assert.equal(p.source.evidenceId, e.id);
      assert.equal(p.source.metric, series.metric);
      const row: Evidence["rows"][number] = e.rows[p.source.rowIndex];
      assert.ok(row);
      assert.equal(p.value, row.values[p.source.metric]);
      assert.deepEqual(p.dimensions, row.dimensions);
      assert.equal(p.period, row.period);
      assert.equal(p.bucket, row.bucket);
    }
  }
  return {
    type: c.type,
    metric: c.series[0].metric,
    evidenceId: e.id,
    points: c.series.reduce((n, s) => n + s.points.length, 0),
    unit: c.yAxis.unit,
  };
}
const cases = [
  {
    name: "channel-comparison",
    expected: "bar",
    spec: { ...DEFAULT_SPEC, groupBy: ["channel" as const] },
  },
  {
    name: "calendar-trend",
    expected: "line",
    spec: {
      ...DEFAULT_SPEC,
      mode: "calendar" as const,
      audience: "all" as const,
      timeGrain: "month" as const,
      metrics: ["revenue" as const],
    },
  },
  {
    name: "purchase-composition",
    expected: "stacked_bar",
    spec: {
      ...DEFAULT_SPEC,
      metrics: [
        "revenue" as const,
        "first_purchase_revenue" as const,
        "repeat_purchase_revenue" as const,
      ],
    },
  },
];
const checks = [];
for (const test of cases) {
  const e = await api.query(test.spec);
  cache.set(e.id, e);
  const response = chartResponseSchema.parse(await api.evidenceCharts(e.id));
  assert.equal(response.charts[0].type, test.expected);
  checks.push({
    name: test.name,
    charts: await Promise.all(response.charts.map(checkChart)),
  });
}
const agentRuns: {
  runId: string;
  question: string;
  status: Run["status"];
  durationMs: number;
  charts: Awaited<ReturnType<typeof checkChart>>[];
  modelCalls: number;
  spec: Run["context"]["spec"];
}[] = [];
if (process.argv.includes("--agent")) {
  const c = await api.createConversation();
  async function turn(
    question: string,
    options: Parameters<typeof api.send>[2] = {},
  ) {
    const start = Date.now();
    const q = await api.send(c.id, question, options);
    const response = await fetch(url + "/api/v1/runs/" + q.id + "/events");
    const events = await response.text();
    assert.ok(events.includes("event: done"));
    const run: Run = await api.run(q.id);
    assert.ok(["completed", "limited"].includes(run.status), run.message);
    assert.ok(run.modelTraces.some((t) => t.role === "reviewer"));
    assert.ok(run.answer?.charts?.length);
    const charts = await Promise.all(run.answer.charts.map(checkChart));
    for (const chart of charts)
      assert.ok(run.evidenceIds.includes(chart.evidenceId));
    agentRuns.push({
      runId: run.id,
      question,
      status: run.status,
      durationMs: Date.now() - start,
      charts,
      modelCalls: run.modelTraces.length,
      spec: run.context.spec,
    });
    return run;
  }
  const first = await turn(
    "为什么2019年7月比6月费用增加，新用户首访后14天收入却没有同步增长？",
  );
  const next = await turn("只看TipTop，观察窗口改成7天，其他条件不变。", {
    patch: { filters: { channels: ["TipTop"] }, windowDays: 7 },
  });
  assert.equal(next.context.taskKind, "why");
  for (const chart of next.answer!.charts!) {
    assert.equal(chart.source.spec.windowDays, 7);
    assert.deepEqual(chart.source.spec.filters.channels, ["TipTop"]);
    assert.deepEqual(chart.source.spec.periods, first.context.spec.periods);
    assert.ok(!first.evidenceIds.includes(chart.source.evidenceId));
  }
}
const report = {
  at: new Date().toISOString(),
  result: "PASS",
  health,
  checks,
  agentRuns,
};
await fs.writeFile(
  "evidence/charts-verification.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
