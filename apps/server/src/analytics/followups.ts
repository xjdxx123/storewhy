import { isDeepStrictEqual } from "node:util";
import {
  followupActionSchema,
  type AnalysisSpec,
  type Evidence,
  type ExpectedContext,
  type Fact,
  type Finding,
  type FollowupAction,
  type InvestigationContext,
  type Metric,
  type Dimension,
} from "@storewhy/contracts";
import { AppError } from "../config.ts";
import { ZodError } from "zod";
import { validateSpec } from "./compiler.ts";

function scope(spec: AnalysisSpec) {
  return {
    ...spec,
    timeGrain: spec.timeGrain ?? null,
    windowDays: spec.mode === "calendar" ? null : spec.windowDays,
    metrics: [],
    groupBy: [...spec.groupBy].sort(),
    filters: Object.fromEntries(
      Object.entries(spec.filters).map(([k, v]) => [k, [...v].sort()]),
    ),
  };
}
export function alreadyChecked(target: AnalysisSpec, evidence: Evidence[]) {
  return evidence.some(
    (e) =>
      !e.truncated &&
      isDeepStrictEqual(scope(e.spec), scope(target)) &&
      target.metrics.every((metric) => e.spec.metrics.includes(metric)),
  );
}
export function expectedContext(
  context: InvestigationContext,
): ExpectedContext {
  const {
    conversationId,
    investigationId,
    datasetVersion,
    metricVersion,
    revision,
  } = context;
  return {
    conversationId,
    investigationId,
    datasetVersion,
    metricVersion,
    revision,
  };
}
function question(goal: string, spec: AnalysisSpec) {
  const filters = Object.entries(spec.filters)
    .filter(([, values]) => values.length)
    .map(
      ([key, values]) =>
        `${{ channels: "渠道", devices: "设备", regions: "国家" }[key]}=${values.join("/")}`,
    );
  return `${goal}？时期：${spec.periods.map((p) => `${p.start}至${p.end}（结束日不含）`).join("与")}；${spec.mode === "cohort" ? `首访后${spec.windowDays}天` : "自然时期"}；${spec.audience === "paid" ? "付费渠道用户" : "全部用户"}${filters.length ? "；" + filters.join("；") : ""}。`;
}

/** Recommendations contain validated complete scopes, never model-written SQL or actions. */
export function followupsFor(
  context: InvestigationContext,
  evidence: Evidence[],
  facts: Fact[],
  conclusion: Finding,
  history: Evidence[] = [],
  focus?: Partial<Record<Dimension, string>>,
): FollowupAction[] {
  const base = context.spec;
  const actions: FollowupAction[] = [];
  const seen = [...evidence, ...history].filter(
    (e) =>
      e.datasetVersion === context.datasetVersion &&
      e.metricVersion === context.metricVersion,
  );
  const currentIds = evidence.map((e) => e.id);
  const withMetrics = (...metrics: Metric[]) => [
    ...new Set([...metrics, ...base.metrics]),
  ];
  function propose(
    id: string,
    label: string,
    goal: string,
    reason: string,
    candidate: AnalysisSpec,
  ) {
    if (actions.length >= 3) return;
    let target: AnalysisSpec;
    try {
      target = validateSpec(candidate);
    } catch (error) {
      if (error instanceof AppError || error instanceof ZodError) return;
      throw error;
    }
    if (
      alreadyChecked(target, seen) ||
      actions.some((a) => isDeepStrictEqual(a.patch, target))
    )
      return;
    actions.push(
      followupActionSchema.parse({
        id,
        label,
        message: question(goal, target),
        reason,
        taskKind:
          id === "channel-breakdown" || id === "compare-window"
            ? "followup"
            : "query",
        patch: target,
        basedOn: expectedContext(context),
        evidenceIds: currentIds,
      }),
    );
  }
  const channel =
    focus?.channel ??
    conclusion.factIds
      .map((id) => facts.find((f) => f.id === id))
      .filter((f) => f !== undefined)
      .map(
        (f) =>
          evidence.find((e) => e.id === f.evidenceId)?.rows[f.rowIndex]
            .dimensions.channel,
      )
      .find((v) => v !== undefined);
  if (
    channel &&
    (base.filters.channels.length !== 1 || base.filters.channels[0] !== channel)
  )
    propose(
      "focus-channel",
      `核查 ${channel} 的付费表现`,
      `只看${channel}，进一步比较购买用户比例和每位购买用户收入`,
      "该渠道出现在结论证据中，可继续核查其付费表现。",
      {
        ...base,
        groupBy: [],
        filters: { ...base.filters, channels: [channel] },
        metrics: withMetrics(
          "payer_rate",
          "revenue_per_payer",
          "users",
          "payers",
          "revenue",
        ),
      },
    );
  if (
    !alreadyChecked(
      {
        ...base,
        metrics: ["first_purchase_revenue", "repeat_purchase_revenue"],
      },
      seen,
    )
  )
    propose(
      "purchase-composition",
      "拆分首次与后续购买收入",
      "比较收入变化来自首次购买还是后续购买",
      "尚未在当前范围完成首次与后续购买收入的拆分。",
      {
        ...base,
        metrics: withMetrics(
          "first_purchase_revenue",
          "repeat_purchase_revenue",
          "revenue",
          "repeat_payer_rate",
        ),
      },
    );
  if (
    !alreadyChecked(
      { ...base, metrics: ["payer_rate", "revenue_per_payer"] },
      seen,
    )
  )
    propose(
      "payer-performance",
      "核查付费比例与每位购买用户收入",
      "比较购买用户比例和每位购买用户收入的变化",
      "补充付费比例及每位购买用户收入，核查收入变化发生在哪一环。",
      {
        ...base,
        metrics: withMetrics(
          "users",
          "payers",
          "payer_rate",
          "revenue",
          "revenue_per_payer",
        ),
      },
    );
  if (
    !base.timeGrain &&
    base.groupBy.length === 0 &&
    base.filters.channels.length !== 1
  )
    propose(
      "channel-breakdown",
      "按渠道拆分变化",
      "按首次观测渠道比较这些指标的变化",
      "当前范围仍可按渠道定位具体变化。",
      { ...base, groupBy: ["channel"] },
    );
  if (base.mode === "cohort") {
    const windowDays = base.windowDays === 14 ? 7 : 14;
    propose(
      "compare-window",
      `改用首访后 ${windowDays} 天核查`,
      `将观察窗口改成首访后${windowDays}天，核查这些指标的变化`,
      "用另一种完整观察窗口检验结论是否依赖观察时长。",
      { ...base, windowDays },
    );
  }
  // A monthly, ungrouped view stays within the 200-row bound. It explicitly changes the time basis.
  propose(
    "calendar-trend",
    "查看自然月收入趋势",
    "切换为自然时期，不分组查看按月收入趋势",
    "自然时期趋势回答变化发生在哪个月；口径将明确切换。",
    {
      ...base,
      mode: "calendar",
      timeGrain: "month",
      groupBy: [],
      metrics: ["revenue"],
    },
  );
  return actions;
}
