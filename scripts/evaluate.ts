import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "../apps/server/src/app.ts";
import { ZetarisBackend } from "../apps/server/src/integrations/zetaris.ts";
import { createConversation } from "../apps/server/src/context/store.ts";
import type { Run, Conversation } from "@storewhy/contracts";
const dir = mkdtempSync(path.join(tmpdir(), "storewhy-live-eval-"));
const server = await buildApp({ backend: new ZetarisBackend(), stateDir: dir });
type Check = {
  name: string;
  question: string;
  expected?: Record<string, unknown>;
  statuses?: string[];
  metrics?: string[];
};
const fixed: Check[] = [
  {
    name: "why-spend",
    question:
      "为什么样例中2019年7月比6月费用更多，获客后14天收入却没有相应增长？",
    expected: { mode: "cohort", windowDays: 14 },
    metrics: ["spend", "revenue"],
  },
  {
    name: "calendar-revenue",
    question:
      "查询2019年7月所有用户自然月购买收入，不限付费渠道，只要收入汇总。",
    expected: { mode: "calendar", audience: "all" },
    metrics: ["revenue"],
  },
  {
    name: "channel-contribution",
    question: "比较2019年6月和7月各渠道的新用户14天收入，哪些渠道增加最多？",
    expected: { mode: "cohort", groupBy: ["channel"] },
    metrics: ["revenue"],
  },
  {
    name: "first-repeat",
    question: "2019年7月自然月收入，首次购买和后续购买分别多少？包含organic。",
    expected: { mode: "calendar", audience: "all" },
    metrics: ["first_purchase_revenue", "repeat_purchase_revenue"],
  },
  {
    name: "cohort-delay",
    question:
      "查询2019年7月付费渠道新用户，首访后7天的购买用户比例和首次购买平均等待小时。",
    expected: { mode: "cohort", windowDays: 7 },
    metrics: ["payer_rate", "avg_first_purchase_hours"],
  },
  {
    name: "device",
    question:
      "2019年7月付费渠道新用户14天内，按首次设备比较iPhone和Android的付费比例与收入，不看广告费用。",
    expected: { mode: "cohort", groupBy: ["device"] },
    metrics: ["payer_rate", "revenue"],
  },
  {
    name: "monthly-trend",
    question: "查询2019年5月至7月所有用户按自然月的收入趋势，包含organic。",
    expected: { mode: "calendar", timeGrain: "month", audience: "all" },
    metrics: ["revenue"],
  },
  {
    name: "immature",
    question: "只查询2019年10月25日至27日新用户的完整14天收入。",
    statuses: ["unsupported", "needs_clarification"],
  },
  {
    name: "clicks",
    question: "2019年7月FaceBoom的CTR和CPC分别是多少？",
    statuses: ["unsupported"],
  },
  {
    name: "device-cost",
    question: "计算2019年7月iPhone人群的广告获客费用。",
    statuses: ["unsupported"],
  },
  {
    name: "real-time",
    question: "查询今年这个月的总收入。",
    statuses: ["needs_clarification", "unsupported"],
  },
  {
    name: "organic-cost",
    question: "organic渠道2019年7月花了多少广告费用？",
    statuses: ["unsupported"],
  },
];
// Held-out phrasings are evaluator inputs only, never part of agent prompts or routing.
const held: Check[] = [
  {
    name: "h1",
    question:
      "把样本里二零一九年七月份的账面收入按获客来源列一下，要自然月、全部用户。",
    expected: { mode: "calendar", audience: "all", groupBy: ["channel"] },
    metrics: ["revenue"],
  },
  {
    name: "h2",
    question: "只要FaceBoom，比较六月与七月拉来的用户首周收入与获客人数。",
    expected: {
      mode: "cohort",
      windowDays: 7,
      filters: { channels: ["FaceBoom"] },
    },
    metrics: ["revenue", "new_users"],
  },
  {
    name: "h3",
    question:
      "2019年七月份UK和France的用户付费情况有什么差别？按首访国家、完整14天，仅行为指标。",
    expected: { mode: "cohort", groupBy: ["region"] },
    metrics: ["payer_rate"],
  },
  {
    name: "h4",
    question:
      "样例2019年七月，在付费用户中，有多少人买过不止一次？给复购比例，用新获客后两周口径。",
    expected: { mode: "cohort", windowDays: 14 },
    metrics: ["repeat_payer_rate"],
  },
  {
    name: "h5",
    question:
      "Can you show daily revenue in July 2019 for all users, including organic?",
    expected: { mode: "calendar", audience: "all", timeGrain: "day" },
    metrics: ["revenue"],
  },
  {
    name: "h6",
    question:
      "2019年8月TipTop拉来的用户，两周内有多少新用户、多少购买用户、产生多少收入？",
    expected: {
      mode: "cohort",
      windowDays: 14,
      filters: { channels: ["TipTop"] },
    },
    metrics: ["new_users", "payers", "revenue"],
  },
  {
    name: "h7",
    question:
      "样例六月对比七月，为什么收入对广告费的比值下降？请核查渠道结构，只谈观测数据。",
    expected: { mode: "cohort" },
    metrics: ["spend", "revenue"],
  },
  {
    name: "h8",
    question: "2019年七月按首次观测设备和国家列收入与人数，别算费用。",
    expected: { groupBy: ["device", "region"] },
    metrics: ["revenue", "users"],
  },
  {
    name: "h9",
    question: "帮我找2019年7月哪条广告素材疲劳导致点击率下降。",
    statuses: ["unsupported"],
  },
  {
    name: "h10",
    question:
      "把2019年10月下旬用户当成完整两周的成熟批次来算，别告诉我随访不足。",
    statuses: ["unsupported", "needs_clarification"],
  },
];
const month = (m: number) => ({
  start: `2019-${String(m).padStart(2, "0")}-01`,
  end: `2019-${String(m + 1).padStart(2, "0")}-01`,
});
const expectedPeriods: Record<string, { start: string; end: string }[]> = {
  "why-spend": [month(6), month(7)],
  "calendar-revenue": [month(7)],
  "channel-contribution": [month(6), month(7)],
  "first-repeat": [month(7)],
  "cohort-delay": [month(7)],
  device: [month(7)],
  "monthly-trend": [{ start: "2019-05-01", end: "2019-08-01" }],
  h1: [month(7)],
  h2: [month(6), month(7)],
  h3: [month(7)],
  h4: [month(7)],
  h5: [month(7)],
  h6: [month(8)],
  h7: [month(6), month(7)],
  h8: [month(7)],
};
for (const test of [...fixed, ...held])
  if (expectedPeriods[test.name])
    test.expected = { ...test.expected, periods: expectedPeriods[test.name] };
const fresh: Check[] = [
  {
    name: "v2-1",
    question: "只列FaceBoom在2019年八月份新获得的用户，一星期内入账多少？",
    expected: {
      mode: "cohort",
      windowDays: 7,
      filters: { channels: ["FaceBoom"] },
      periods: [month(8)],
    },
    metrics: ["revenue"],
  },
  {
    name: "v2-2",
    question: "列出2019年六月按周汇总的访问次数和购买收入，organic也算上。",
    expected: {
      mode: "calendar",
      timeGrain: "week",
      audience: "all",
      periods: [month(6)],
    },
    metrics: ["sessions", "revenue"],
  },
  {
    name: "v2-3",
    question:
      "2019年九月新获客后两星期，按首次设备比较Android与PC的购买用户比例，只分析行为。",
    expected: {
      mode: "cohort",
      windowDays: 14,
      groupBy: ["device"],
      periods: [month(9)],
    },
    metrics: ["payer_rate"],
  },
  {
    name: "v2-4",
    question:
      "以2019-06-01到2019-07-01首次出现为批次，只看UK的用户，观察七日内收入，不计算成本。",
    expected: {
      mode: "cohort",
      windowDays: 7,
      filters: { regions: ["UK"] },
      periods: [month(6)],
    },
    metrics: ["revenue"],
  },
  {
    name: "v2-5",
    question:
      "2019年八月全部用户自然月有多少购买事件？把首笔和非首笔购买产生的收入拆开。",
    expected: { mode: "calendar", audience: "all", periods: [month(8)] },
    metrics: ["purchases", "first_purchase_revenue", "repeat_purchase_revenue"],
  },
  {
    name: "v2-6",
    question:
      "二零一九年七月，RocketSuperAds与YRabbit获得的新客，两周内收入和新客数分别是多少？",
    expected: { mode: "cohort", windowDays: 14, periods: [month(7)] },
    metrics: ["revenue", "new_users"],
  },
  {
    name: "v2-7",
    question:
      "2019年七月份首次访问的用户，十四天内哪个首次国家的用户收入最高？按国家列出。",
    expected: {
      mode: "cohort",
      windowDays: 14,
      groupBy: ["region"],
      periods: [month(7)],
    },
    metrics: ["revenue"],
  },
  {
    name: "v2-8",
    question: "查看样本2019年六月到八月每月收入的走势，把自然流量也包括在内。",
    expected: {
      mode: "calendar",
      timeGrain: "month",
      audience: "all",
      periods: [{ start: "2019-06-01", end: "2019-09-01" }],
    },
    metrics: ["revenue"],
  },
  {
    name: "v2-9",
    question: "请证明这个平台多投广告一定会带来增量销售。",
    statuses: ["unsupported"],
  },
  {
    name: "v2-10",
    question: "估算2019年八月iPhone用户对应的广告投放支出。",
    statuses: ["unsupported"],
  },
];
const records: any[] = [];
function partial(actual: unknown, want: unknown): boolean {
  if (Array.isArray(want))
    return (
      Array.isArray(actual) &&
      actual.length === want.length &&
      want.every((v, i) => partial(actual[i], v))
    );
  if (want && typeof want === "object")
    return Object.entries(want).every(([k, v]) =>
      partial((actual as any)?.[k], v),
    );
  return actual === want;
}
async function turn(
  c: Conversation,
  test: Check,
  group: string,
  newInvestigation = false,
) {
  const start = Date.now();
  const queued = server.engine.createRun(c.id, {
    message: test.question,
    newInvestigation,
  });
  let run: Run;
  do {
    await new Promise((r) => setTimeout(r, 150));
    run = server.disk.get<Run>("runs", queued.id);
  } while (["queued", "running"].includes(run.status));
  const errors: string[] = [];
  if (!(test.statuses ?? ["completed", "limited"]).includes(run.status))
    errors.push("status:" + run.status + ":" + run.message);
  if (test.expected && !partial(run.context.spec, test.expected))
    errors.push("scope mismatch: " + JSON.stringify(run.context.spec));
  if (test.metrics?.some((m) => !run.context.spec.metrics.includes(m as any)))
    errors.push("missing metrics");
  if (test.name.startsWith("a-") && run.context.taskKind !== "why")
    errors.push("Lost original why objective");
  for (const f of run.answer?.facts ?? []) {
    const evidence = server.disk.get<any>("evidence", f.evidenceId);
    if (
      evidence.backend !== "zetaris" ||
      evidence.rows[f.rowIndex]?.values[f.metric] !== f.value
    )
      errors.push("unbound fact");
  }
  const record = {
    group,
    name: test.name,
    question: test.question,
    pass: errors.length === 0,
    errors,
    status: run.status,
    message: run.message,
    spec: run.context.spec,
    evidenceCount: run.evidenceIds.length,
    queryCount: run.events.filter((e) => e.type === "query_started").length,
    reviewDecisions: run.events
      .filter((e) => e.type === "review_completed")
      .map((e) => e.data),
    durationMs: Date.now() - start,
    models: run.modelTraces,
    runId: run.id,
  };
  records.push(record);
  console.log(
    JSON.stringify({
      name: test.name,
      pass: record.pass,
      status: record.status,
      ms: record.durationMs,
      errors,
    }),
  );
  return run;
}
try {
  const followupsOnly = process.argv.includes("--followups-only");
  const all = followupsOnly
    ? []
    : process.argv.includes("--smoke")
      ? fixed.slice(0, 2)
      : fixed;
  for (const test of all)
    await turn(
      createConversation(server.disk, server.analytics.datasetVersion),
      test,
      "fixed",
    );
  if (!process.argv.includes("--smoke")) {
    for (const test of followupsOnly ? [] : held)
      await turn(
        createConversation(server.disk, server.analytics.datasetVersion),
        test,
        "heldout",
      );
    for (const test of followupsOnly ? [] : fresh)
      await turn(
        createConversation(server.disk, server.analytics.datasetVersion),
        test,
        "heldout-v2",
      );
    const groups: Check[][] = [
      [
        fixed[0],
        {
          name: "a-channel",
          question: "只看FaceBoom。",
          expected: { filters: { channels: ["FaceBoom"] } },
        },
        {
          name: "a-window",
          question: "观察窗口改成7天，其他不变。",
          expected: { windowDays: 7, filters: { channels: ["FaceBoom"] } },
        },
        {
          name: "a-clear",
          question: "清除渠道限制，看全部付费渠道，窗口不变。",
          expected: { windowDays: 7, filters: { channels: [] } },
        },
      ],
      [
        fixed[1],
        {
          name: "b-period",
          question: "只保留2019年6月，自然月。",
          expected: {
            mode: "calendar",
            periods: [{ start: "2019-06-01", end: "2019-07-01" }],
          },
        },
        {
          name: "b-country",
          question: "只看首次观测国家是France的用户，其他不变。",
          expected: { filters: { regions: ["France"] }, periods: [month(6)] },
        },
        {
          name: "b-clear",
          question: "清除国家筛选。",
          expected: {
            filters: { regions: [] },
            audience: "all",
            periods: [month(6)],
          },
        },
      ],
      [
        {
          name: "c-start",
          question: "查询2019年6月付费渠道新用户完整14天收入。",
          expected: { mode: "cohort", windowDays: 14 },
        },
        {
          name: "c-channel",
          question: "只保留TipTop。",
          expected: { filters: { channels: ["TipTop"] }, periods: [month(6)] },
        },
        {
          name: "c-correct",
          question: "刚才月份写错了，改成2019年7月，渠道和窗口都保持。",
          expected: {
            windowDays: 14,
            filters: { channels: ["TipTop"] },
            periods: [{ start: "2019-07-01", end: "2019-08-01" }],
          },
        },
        {
          name: "c-reset",
          question: "开始新分析：查询2019年8月所有付费渠道的新用户14天收入。",
          expected: { windowDays: 14, filters: { channels: [] } },
        },
      ],
    ];
    for (let i = 0; i < groups.length; i++) {
      const c = createConversation(
        server.disk,
        server.analytics.datasetVersion,
      );
      for (let j = 0; j < groups[i].length; j++)
        await turn(c, groups[i][j], "followup-" + i, i === 2 && j === 3);
    }
  }
} finally {
  const report = {
    at: new Date().toISOString(),
    dataBackend: "zetaris",
    model: server.engine.model.constructor.name,
    modelId: process.env.METERLESS_MODEL,
    datasetVersion: server.analytics.datasetVersion,
    stateDir: dir,
    total: records.length,
    passed: records.filter((r) => r.pass).length,
    records,
  };
  await fs.mkdir("evidence", { recursive: true });
  await fs.writeFile(
    process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ??
      (process.argv.includes("--followups-only")
        ? "evidence/followup-evaluation.json"
        : process.argv.includes("--smoke")
          ? "evidence/agent-smoke.json"
          : "evidence/agent-evaluation.json"),
    JSON.stringify(report, null, 2),
  );
  await server.app.close();
  if (records.some((r) => !r.pass)) process.exitCode = 1;
}
