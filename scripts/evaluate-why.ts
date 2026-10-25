import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AnalysisSpec,
  Evidence,
  Run,
  ContextPatch,
} from "@storewhy/contracts";
import { buildApp } from "../apps/server/src/app.ts";
import { ZetarisBackend } from "../apps/server/src/integrations/zetaris.ts";
import { createConversation } from "../apps/server/src/context/store.ts";

type Case = {
  id: string;
  question: string;
  expected?: ContextPatch;
  metrics?: string[];
  statuses?: string[];
};
const month = (m: number) => ({
  label: `2019-${String(m).padStart(2, "0")}`,
  start: `2019-${String(m).padStart(2, "0")}-01`,
  end: `2019-${String(m + 1).padStart(2, "0")}-01`,
});
// Evaluation-only questions: never included in Agent prompts or routing.
const cases: Case[] = [
  {
    id: "w1-channel-efficiency",
    question:
      "为什么2019年6月相较5月，付费渠道新用户首访后14天收入与广告费用比发生变化？请检验渠道构成。",
    expected: { mode: "cohort", windowDays: 14, periods: [month(5), month(6)] },
    metrics: ["spend", "revenue"],
  },
  {
    id: "w2-revenue-factors",
    question:
      "只分析TipTop：为什么2019年9月与8月新用户首访后14天收入不同？请检查新用户数、购买用户比例和每位购买用户收入。",
    expected: {
      mode: "cohort",
      windowDays: 14,
      periods: [month(8), month(9)],
      filters: { channels: ["TipTop"] },
    },
    metrics: ["new_users", "payer_rate", "revenue_per_payer", "revenue"],
  },
  {
    id: "w3-purchase-composition",
    question:
      "为什么2019年7月比6月全部用户自然月收入有变化？请区分首次购买和后续购买收入，包含organic。",
    expected: {
      mode: "calendar",
      audience: "all",
      periods: [month(6), month(7)],
    },
    metrics: ["revenue", "first_purchase_revenue", "repeat_purchase_revenue"],
  },
  {
    id: "w4-conversion",
    question:
      "为什么FaceBoom在2019年8月相较7月新用户首周购买用户比例不同？请只检查行为数据，不分析广告费用。",
    expected: {
      mode: "cohort",
      windowDays: 7,
      periods: [month(7), month(8)],
      filters: { channels: ["FaceBoom"] },
    },
    metrics: ["payer_rate"],
  },
  {
    id: "w5-maturity",
    question:
      "为什么2019年10月与9月付费渠道新用户首访后14天收入不同？是否只是观察时间太短？请检查完整随访和被排除的用户。",
    expected: {
      mode: "cohort",
      windowDays: 14,
      periods: [month(9), month(10)],
    },
    metrics: ["revenue"],
  },
  {
    id: "w6-device",
    question:
      "为什么2019年7月比6月iPhone和Android新用户首访后14天收入变化不同？按首次设备检查用户数与付费比例，只谈行为，不查费用。",
    expected: {
      mode: "cohort",
      windowDays: 14,
      periods: [month(6), month(7)],
      groupBy: ["device"],
      audience: "paid",
      filters: { devices: ["iPhone", "Android"] },
    },
    metrics: ["revenue", "payer_rate"],
  },
  {
    id: "w7-region",
    question:
      "只看首次国家United States，为什么2019年8月相较7月新用户两周收入有变化？核查用户规模与购买用户比例，不涉及广告费用。",
    expected: {
      mode: "cohort",
      windowDays: 14,
      periods: [month(7), month(8)],
      filters: { regions: ["United States"] },
      audience: "paid",
    },
    metrics: ["revenue", "payer_rate"],
  },
  {
    id: "w8-repeat-channels",
    question:
      "为什么RocketSuperAds和YRabbit在2019年9月相较8月新用户14天收入有变化？按渠道拆分首次购买和后续购买收入，不分析费用。",
    expected: {
      mode: "cohort",
      windowDays: 14,
      periods: [month(8), month(9)],
      groupBy: ["channel"],
      filters: { channels: ["RocketSuperAds", "YRabbit"] },
    },
    metrics: ["revenue", "first_purchase_revenue", "repeat_purchase_revenue"],
  },
  {
    id: "n1-false-premise",
    question:
      "只看FaceBoom，为什么2019年7月比6月广告费用增加，新用户首访后14天收入却减少？先核实前提。",
    expected: {
      mode: "cohort",
      windowDays: 14,
      periods: [month(6), month(7)],
      filters: { channels: ["FaceBoom"] },
    },
    metrics: ["spend", "revenue"],
  },
  {
    id: "n2-missing-clicks",
    question:
      "为什么2019年7月TipTop的广告CTR下降？请用曝光和点击记录验证是否素材疲劳。",
    statuses: ["unsupported"],
  },
];
const groups: { base: string; turns: Case[] }[] = [
  {
    base: "w1-channel-efficiency",
    turns: [
      {
        id: "f1-channel",
        question: "只看TipTop，其他条件不变。",
        expected: { filters: { channels: ["TipTop"] } },
      },
      {
        id: "f1-window",
        question: "观察窗口改成7天，月份和渠道不变。",
        expected: { windowDays: 7, filters: { channels: ["TipTop"] } },
      },
      {
        id: "f1-clear",
        question: "清除渠道筛选，看全部付费渠道，月份和窗口不变。",
        expected: { windowDays: 7, filters: { channels: [] } },
      },
    ],
  },
  {
    base: "w3-purchase-composition",
    turns: [
      {
        id: "f2-period",
        question: "时期改为2019年8月和9月，其他条件不变。",
        expected: {
          periods: [month(8), month(9)],
          mode: "calendar",
          audience: "all",
        },
      },
      {
        id: "f2-region",
        question: "只看首次国家France，月份和指标不变。",
        expected: {
          filters: { regions: ["France"] },
          periods: [month(8), month(9)],
          audience: "all",
        },
      },
      {
        id: "f2-clear",
        question: "清除国家筛选，其他条件不变。",
        expected: {
          filters: { regions: [] },
          periods: [month(8), month(9)],
          audience: "all",
        },
      },
    ],
  },
];
const output =
  process.argv.find((a) => a.startsWith("--output="))?.slice(9) ??
  "evidence/why-reliability-final.json";
const only = process.argv
  .find((a) => a.startsWith("--cases="))
  ?.slice(8)
  .split(",");
const dir = mkdtempSync(path.join(tmpdir(), "storewhy-why-eval-"));
const server = await buildApp({ backend: new ZetarisBackend(), stateDir: dir });
const records: Record<string, any>[] = [];
function partial(actual: any, expected: any): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((v, i) => partial(actual[i], v))
    );
  if (expected && typeof expected === "object")
    return Object.entries(expected).every(
      ([k, v]) => k === "label" || partial(actual?.[k], v),
    );
  return actual === expected;
}
async function save() {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(
    output,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        kind: "recorded_live_why_reliability",
        datasetVersion: server.analytics.datasetVersion,
        stateDir: dir,
        total: records.length,
        passed: records.filter((r) => r.pass).length,
        records,
      },
      null,
      2,
    ) + "\n",
  );
}
async function turn(conversationId: string, test: Case, previous?: Run) {
  const start = Date.now();
  const queued = server.engine.createRun(conversationId, {
    message: test.question,
  });
  let run: Run;
  do {
    await new Promise((r) => setTimeout(r, 100));
    run = server.disk.get<Run>("runs", queued.id);
  } while (["queued", "running"].includes(run.status));
  const errors: string[] = [],
    qualityGaps: string[] = [];
  if (!(test.statuses ?? ["completed", "limited"]).includes(run.status))
    errors.push(`status:${run.status}:${run.message}`);
  if (test.expected && !partial(run.context.spec, test.expected))
    errors.push("scope mismatch");
  if (
    test.metrics?.some(
      (m) =>
        !run.context.spec.metrics.includes(
          m as AnalysisSpec["metrics"][number],
        ),
    )
  )
    errors.push("missing required metrics");
  const evidence = run.evidenceIds.map((id) =>
    server.disk.get<Evidence>("evidence", id),
  );
  const a = run.answer;
  if (!test.statuses && a) {
    if (run.context.taskKind !== "why") errors.push("lost Why task");
    if (!run.modelTraces.some((t) => t.role === "reviewer"))
      errors.push("no Reviewer");
    if (previous) {
      if (run.context.objective !== previous.context.objective)
        errors.push("lost objective");
      if (run.context.revision !== previous.context.revision + 1)
        errors.push("revision mismatch");
      if (run.context.investigationId !== previous.context.investigationId)
        errors.push("lost investigation");
      if (
        !test.expected?.periods &&
        !partial(run.context.spec.periods, previous.context.spec.periods)
      )
        errors.push("lost periods");
      if (
        !test.expected?.windowDays &&
        run.context.spec.windowDays !== previous.context.spec.windowDays
      )
        errors.push("lost window");
      if (!partial(run.context.spec.metrics, previous.context.spec.metrics))
        errors.push("lost metrics");
    }
    for (const fact of a.facts) {
      const e = evidence.find((e) => e.id === fact.evidenceId);
      if (
        e?.backend !== "zetaris" ||
        e.rows[fact.rowIndex]?.values[fact.metric] !== fact.value
      )
        errors.push("unbound fact");
    }
    for (const f of [
      a.conclusion,
      ...(a.keyEvidence ?? []),
      ...a.findings,
    ].filter(Boolean))
      if (
        !f!.factIds.length ||
        f!.factIds.some((id) => !a.facts.some((fact) => fact.id === id))
      )
        errors.push("unbound finding");
    const explanations = (
      a as typeof a & {
        explanations?: {
          status: string;
          factIds: string[];
          evidenceIds: string[];
          coverageRefs?: { evidenceId: string; period: string }[];
        }[];
      }
    ).explanations;
    if (!explanations?.length)
      qualityGaps.push("no structured explanation coverage");
    else
      for (const explanation of explanations) {
        if (
          ["supported", "contradicted"].includes(explanation.status) &&
          (!(explanation.factIds.length || explanation.coverageRefs?.length) ||
            explanation.evidenceIds.some((id) => !run.evidenceIds.includes(id)))
        )
          errors.push("unbound explanation");
      }
    if (
      evidence.some((e) => e.coverage.some((c) => c.excludedUsers > 0)) &&
      !a.limitations.some((l) => /排除|裁剪|随访/.test(l))
    )
      qualityGaps.push("maturity clipping not disclosed");
    if (
      test.id === "n1-false-premise" &&
      (!a.summary.includes("费用减少") || !a.summary.includes("收入增加"))
    )
      errors.push("false premise repeated");
  } else if (!test.statuses) errors.push("missing answer");
  if (test.statuses && run.evidenceIds.length)
    errors.push("unsupported request queried unrelated data");
  const record = {
    id: test.id,
    question: test.question,
    expected: test.expected,
    requiredMetrics: test.metrics,
    pass: !errors.length && !qualityGaps.length,
    errors,
    qualityGaps,
    status: run.status,
    message: run.message,
    runId: run.id,
    context: run.context,
    answer: a ? { ...a, charts: undefined } : undefined,
    evidence: evidence.map(({ sql: _sql, ...e }) => e),
    reviews: run.events.filter((e) =>
      ["hypothesis", "review_completed"].includes(e.type),
    ),
    queryCount: run.events.filter((e) => e.type === "query_started").length,
    models: run.modelTraces,
    durationMs: Date.now() - start,
  };
  records.push(record);
  await save();
  console.log(
    JSON.stringify({
      id: test.id,
      status: run.status,
      pass: record.pass,
      errors,
      qualityGaps,
      summary: a?.summary,
      ms: record.durationMs,
    }),
  );
  return run;
}
try {
  for (const test of cases) {
    if (
      only &&
      !only.includes(test.id) &&
      !groups.some(
        (g) => g.base === test.id && g.turns.some((t) => only.includes(t.id)),
      )
    )
      continue;
    const c = createConversation(server.disk, server.analytics.datasetVersion);
    let last = await turn(c.id, test);
    const group = groups.find((g) => g.base === test.id);
    for (const next of group?.turns ?? []) {
      if (!only || only.includes(next.id)) last = await turn(c.id, next, last);
    }
  }
} finally {
  await save();
  await server.app.close();
}
console.log(
  JSON.stringify({
    total: records.length,
    passed: records.filter((r) => r.pass).length,
    output,
  }),
);
if (records.some((r) => !r.pass)) process.exitCode = 1;
