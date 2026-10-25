import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  CONTRACT_VERSION,
  followupActionSchema,
  type Evidence,
  type Fact,
  type Run,
} from "@storewhy/contracts";
import { StoreWhyClient } from "@storewhy/contracts/client";
const url = process.env.STOREWHY_HTTP_URL ?? "http://127.0.0.1:3100";
const api = new StoreWhyClient(url);
const health = await (await fetch(url + "/healthz")).json();
assert.equal(health.apiVersion, CONTRACT_VERSION);
assert.equal(health.dataMode, "zetaris");
const records: unknown[] = [];
const output =
  process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ??
  "evidence/answer-quality-evaluation.json";
async function check(
  name: string,
  queued: Run,
  extra?: (run: Run, evidence: Evidence[]) => void,
) {
  const start = Date.now();
  const events = await (
    await fetch(url + "/api/v1/runs/" + queued.id + "/events")
  ).text();
  assert.ok(events.includes("event: done"));
  const run = await api.run(queued.id),
    a = run.answer;
  assert.ok(["completed", "limited"].includes(run.status), run.message);
  assert.ok(a?.conclusion && a.keyEvidence && a.followups);
  assert.equal(a.summary, a.conclusion.text);
  assert.ok(
    !/已按当前范围完成统计|以下观测变化及其结构贡献已通过/.test(a.summary),
  );
  assert.ok(a.conclusion.factIds.length > 0);
  assert.ok(a.keyEvidence.length >= 1 && a.keyEvidence.length <= 3);
  const evidence = await Promise.all(
    run.evidenceIds.map((id) => api.evidence(id)),
  );
  for (const finding of [a.conclusion, ...a.keyEvidence]) {
    for (const id of finding.factIds) {
      const fact: Fact | undefined = a.facts.find((f) => f.id === id);
      assert.ok(fact);
      const source: Evidence | undefined = evidence.find(
        (e) => e.id === fact.evidenceId,
      );
      assert.equal(source?.backend, "zetaris");
      assert.equal(fact.value, source.rows[fact.rowIndex].values[fact.metric]);
    }
  }
  for (const action of a.followups) {
    followupActionSchema.parse(action);
    assert.deepEqual(action.patch.periods, run.context.spec.periods);
    assert.equal(action.patch.audience, run.context.spec.audience);
    assert.equal(action.basedOn.revision, run.context.revision);
    assert.equal(action.basedOn.conversationId, run.conversationId);
    assert.ok(action.evidenceIds.every((id) => run.evidenceIds.includes(id)));
    for (const k of ["channels", "devices", "regions"] as const) {
      const constrained = run.context.spec.filters[k];
      if (constrained.length)
        assert.ok(
          action.patch.filters[k].length &&
            action.patch.filters[k].every((v) => constrained.includes(v)),
        );
    }
  }
  if (a.followups.length)
    assert.deepEqual(
      a.nextSteps,
      a.followups.map((f) => f.message),
    );
  extra?.(run, evidence);
  const referenced = new Set(
    [a.conclusion, ...a.keyEvidence].flatMap((f) => f.factIds),
  );
  const record = {
    name,
    pass: true,
    runId: run.id,
    status: run.status,
    durationMs: Date.now() - start,
    question: run.question,
    context: run.context,
    answer: {
      ...a,
      facts: a.facts.filter((f) => referenced.has(f.id)),
      charts: undefined,
    },
    evidence: evidence.map(
      ({
        id,
        datasetVersion,
        metricVersion,
        spec,
        rows,
        comparisons,
        coverage,
        queryIds,
      }) => ({
        id,
        datasetVersion,
        metricVersion,
        spec,
        rows,
        comparisons,
        coverage,
        queryIds,
      }),
    ),
    modelTraces: run.modelTraces,
  };
  records.push(record);
  console.log(
    JSON.stringify({
      name,
      status: run.status,
      summary: a.summary,
      followups: a.followups.map((f) => f.label),
      ms: record.durationMs,
    }),
  );
  await fs.writeFile(
    output,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        kind: "recorded_live_answer_quality",
        baseUrl: url,
        total: records.length,
        passed: records.length,
        records,
      },
      null,
      2,
    ) + "\n",
  );
  return run;
}
const c = await api.createConversation();
const main = await check(
  "main-why",
  await api.send(
    c.id,
    "为什么2019年7月比6月费用增加，新用户首访后14天收入却没有同步增长？",
  ),
  (r) => {
    assert.ok(
      r.answer!.summary.includes("TipTop"),
      "main conclusion should identify the relevant channel",
    );
    assert.ok(r.answer!.keyEvidence!.length >= 2);
    assert.ok(r.answer!.followups!.length >= 2);
  },
);
const focus =
  main.answer!.followups!.find((a) => a.id === "focus-channel") ??
  main.answer!.followups![0];
const narrowed = await check(
  "recommended-followup-1",
  await api.followup(focus),
  (r) => {
    assert.deepEqual(r.context.spec, focus.patch);
    if (focus.id === "focus-channel") {
      assert.equal(r.context.taskKind, "query");
      assert.ok(r.answer!.summary.includes("购买用户比例"));
      assert.ok(r.answer!.summary.includes("%"));
    }
  },
);
await assert.rejects(
  () => api.followup(focus),
  (error: unknown) => (error as { code?: string }).code === "STALE_CONTEXT",
);
const composition =
  narrowed.answer!.followups!.find((a) => a.id === "purchase-composition") ??
  narrowed.answer!.followups![0];
assert.ok(composition);
await check("recommended-followup-2", await api.followup(composition), (r) => {
  assert.deepEqual(r.context.spec, composition.patch);
  assert.deepEqual(r.context.spec.periods, main.context.spec.periods);
});
const other = await api.createConversation();
await check(
  "different-period-why",
  await api.send(
    other.id,
    "比较2019年8月和9月付费渠道新用户首访后14天的表现，为什么收入与广告费用比会变化？请核查具体渠道。",
  ),
  (r) => {
    assert.equal(r.context.spec.periods[0].start, "2019-08-01");
    assert.equal(r.context.spec.periods[1].start, "2019-09-01");
  },
);
const reverse = await api.createConversation();
await check(
  "faceboom-counterexample",
  await api.send(
    reverse.id,
    "只看FaceBoom，为什么2019年7月比6月费用增加，新用户首访后14天收入却没有同步增长？",
  ),
  (r) => {
    assert.deepEqual(r.context.spec.filters.channels, ["FaceBoom"]);
    assert.ok(r.modelTraces.some((t) => t.role === "reviewer"));
    assert.ok(r.answer!.summary.includes("FaceBoom"));
    assert.ok(r.answer!.summary.includes("费用减少"));
    assert.ok(r.answer!.summary.includes("收入增加"));
  },
);
const simple = await api.createConversation();
await check(
  "simple-query",
  await api.send(
    simple.id,
    "查询2019年7月所有用户自然月购买收入，只要收入汇总。",
  ),
  (r) => {
    assert.equal(r.context.taskKind, "query");
    assert.ok(r.answer!.summary.includes("收入"));
  },
);
console.log(
  JSON.stringify({
    result: "PASS",
    checks: records.length,
    staleActionRejected: true,
  }),
);
