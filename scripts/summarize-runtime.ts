import assert from "node:assert/strict";
import fs from "node:fs/promises";
const before = JSON.parse(
  await fs.readFile("evidence/runtime-before.json", "utf8"),
);
const after = JSON.parse(
  await fs.readFile("evidence/runtime-after.json", "utf8"),
);
assert.equal(before.question, after.question);
assert.equal(before.datasetVersion, after.datasetVersion);
assert.equal(before.model, after.model);
assert.ok(before.records.length >= 5 && after.records.length >= 5);
const median = (a: number[]) => {
  const s = [...a].sort((a, b) => a - b);
  return s.length % 2
    ? s[Math.floor(s.length / 2)]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
function userConditions(r: any) {
  const { spec } = r.context;
  return {
    mode: spec.mode,
    timeGrain: spec.timeGrain ?? null,
    periods: spec.periods.map(({ start, end }: any) => ({ start, end })),
    windowDays: spec.windowDays,
    audience: spec.audience,
    filters: Object.fromEntries(
      Object.entries(spec.filters).map(([k, v]) => [
        k,
        [...(v as string[])].sort(),
      ]),
    ),
  };
}
for (const run of [...before.records, ...after.records]) {
  assert.ok(["completed", "limited"].includes(run.status));
  assert.deepEqual(userConditions(run), userConditions(before.records[0]));
  assert.ok(
    ["spend", "revenue"].every((m) => run.context.spec.metrics.includes(m)),
    "the user's requested measures must remain available",
  );
  assert.ok(run.boundFacts > 0);
  assert.ok(run.summary.includes("TipTop"));
  assert.ok(run.firstEventMs < 1000);
}
assert.ok(
  after.records.every((r: any) =>
    r.models.every((t: any) => t.responseFormat === "json_object"),
  ),
  "final route must request JSON object and still validate it locally",
);
const summarize = (p: any) => ({
  samples: p.records.length,
  statuses: p.records.map((r: any) => r.status),
  durationsMs: p.records.map((r: any) => r.durationMs),
  medianMs: median(p.records.map((r: any) => r.durationMs)),
  maxMs: Math.max(...p.records.map((r: any) => r.durationMs)),
  firstEventMs: p.records.map((r: any) => r.firstEventMs),
  modelCalls: p.records.map((r: any) => r.modelCallCount),
  repairCalls: p.records.reduce((s: number, r: any) => s + r.repairCount, 0),
  sqlCount: p.records.map((r: any) => r.queryCount),
  selectedGroupings: p.records.map((r: any) => r.context.spec.groupBy),
  selectedMetrics: p.records.map((r: any) => r.context.spec.metrics),
  medianQueryPathMs: median(
    p.records.map((r: any) =>
      r.evidence.reduce((s: number, e: any) => s + e.durationMs, 0),
    ),
  ),
  medianInputChars: median(
    p.records.map((r: any) =>
      r.modelStages.reduce((s: number, t: any) => s + t.inputChars, 0),
    ),
  ),
});
const b = summarize(before),
  a = summarize(after);
const report = {
  at: new Date().toISOString(),
  pass: true,
  kind: "five_fresh_live_runs_before_after_no_cross_request_cache",
  sameUserConditions: true,
  samePostIntentSpec: after.records.every(
    (r: any) =>
      JSON.stringify({
        ...userConditions(r),
        groupBy: [...r.context.spec.groupBy].sort(),
        metrics: [...r.context.spec.metrics].sort(),
      }) ===
      JSON.stringify({
        ...userConditions(before.records[0]),
        groupBy: [...before.records[0].context.spec.groupBy].sort(),
        metrics: [...before.records[0].context.spec.metrics].sort(),
      }),
  ),
  sameModel: true,
  sameDataset: true,
  before: b,
  after: a,
  medianChangePct: Number(((a.medianMs / b.medianMs - 1) * 100).toFixed(2)),
  inputCharsChangePct: Number(
    ((a.medianInputChars / b.medianInputChars - 1) * 100).toFixed(2),
  ),
  limits: [
    "n=5 per implementation; sequential repeated fresh conversations, no other Live evaluation during benchmark. Provider latency and local SQL scheduling remain variable; this is not a statistical speed guarantee.",
    "Input character comparison counts business messages, excluding the generated JSON schema and transport serialization. It is not a token or cost estimate.",
    "Comparison fixes the question, dates, mode, audience, window and filters, and requires spend/revenue. Grouping and additional measures are endogenous Agent choices, recorded explicitly; identical SQL or post-intent specs are not assumed. All business numbers remain actual Zetaris results.",
    "Internal grounded candidate selection cap is 12; final presentation remains 6 findings / 3 key evidence. All selected IDs are checked, and Why still executes Reviewer.",
    "The final route requests JSON object. Acceptance is not a JSON Schema guarantee: local Zod validation, bounded repair and Why review remain mandatory.",
    "The driver experienced OOM and controlled restarts, and its heap was reduced from 2g to 1g while the local Docker budget increased from about 8 GiB to 10 GiB, between the initial baseline and final sampling. Timing is descriptive and confounded by the platform lifecycle; the pre-restart intermediate five-run comparison is retained separately.",
  ],
};
await fs.writeFile(
  "evidence/runtime-comparison.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
