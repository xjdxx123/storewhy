import { LABELS } from "./catalog.ts";
import type {
  Evidence,
  Fact,
  Finding,
  Answer,
  InvestigationContext,
} from "@storewhy/contracts";
import { catalog } from "./catalog.ts";
import { observationsFor, type Observation } from "./observations.ts";
import { explanationsFor } from "./explanations.ts";
import { followupsFor } from "./followups.ts";
export function presentAnswer(input: {
  context: InvestigationContext;
  evidence: Evidence[];
  facts: Fact[];
  selected?: Observation[];
  headlineObservationId?: string;
  ready: boolean;
  history?: Evidence[];
}): Answer {
  const { context, evidence, facts, ready } = input;
  const selected =
    input.selected ?? observationsFor(evidence, facts, { query: true });
  const observations = observationsFor(evidence, facts);
  const objective = context.objective ?? context.lastQuestion;
  const ratioQuestion = /收入.*(?:费用|广告费).*比|revenue.*spend.*ratio/i.test(
    objective,
  );
  const compositionQuestion = /首次.*(?:后续|复购)|first.*repeat/i.test(
    objective,
  );
  const revenueQuestion =
    /收入|revenue/i.test(objective.split(/[？?；;]/)[0]) &&
    !/比例.*收入|比率.*收入/.test(objective);
  const relevant =
    input.selected &&
    (ratioQuestion
      ? (observations.find(
          (o) => o.kind === "ratio" && o.evidenceId === evidence[0]?.id,
        ) ??
        observations.find(
          (o) =>
            o.kind === "comparison" &&
            o.metrics.includes("revenue_to_spend") &&
            o.evidenceId === evidence[0]?.id,
        ))
      : compositionQuestion
        ? observations.find((o) => o.kind === "composition")
        : revenueQuestion && !observations.some((o) => o.kind === "joint")
          ? (selected.find(
              (o) => o.kind === "comparison" && o.metrics.includes("revenue"),
            ) ??
            observations.find(
              (o) => o.kind === "comparison" && o.metrics.includes("revenue"),
            ))
          : undefined);
  const reversedPremise =
    /费用(?:增加|更多|上升)|(?:广告费|费用).*增/.test(objective) &&
    /收入.*(?:减少|下降|没有|未)/.test(objective)
      ? observations.find(
          (o) =>
            o.kind === "joint" &&
            evidence.some(
              (e) =>
                e.id === o.evidenceId &&
                !e.spec.groupBy.length &&
                e.comparisons.some(
                  (c) =>
                    c.metric === "spend" && c.delta !== null && c.delta < 0,
                ) &&
                e.comparisons.some(
                  (c) =>
                    c.metric === "revenue" && c.delta !== null && c.delta > 0,
                ),
            ),
        )
      : undefined;
  const headline = selected.find(
    (o) => o.id === input.headlineObservationId && o.kind !== "coverage",
  );
  const lead =
    reversedPremise ??
    relevant ??
    headline ??
    selected.find(
      (o) => o.kind === "joint" && Object.keys(o.focus ?? {}).length > 0,
    ) ??
    selected.find((o) => o.kind === "joint") ??
    selected.find((o) => o.kind !== "coverage") ??
    observations.find((o) => o.kind !== "coverage") ??
    selected[0];
  const fallback = facts.find((f) => f.value !== null);
  const finding = (o: Finding): Finding => ({
    text: o.text,
    factIds: [...o.factIds],
  });
  const conclusion: Finding = lead
    ? finding(lead)
    : fallback
      ? {
          text: `${fallback.label} 为${fallback.value}。`,
          factIds: [fallback.id],
        }
      : { text: "当前范围没有可计算的数值。", factIds: [] };
  if (
    !input.selected &&
    context.spec.metrics[0] === "first_purchase_revenue" &&
    context.spec.metrics[1] === "repeat_purchase_revenue"
  ) {
    const other = selected.find(
      (o) =>
        o.evidenceId === lead?.evidenceId &&
        o.metrics.includes("repeat_purchase_revenue") &&
        JSON.stringify(o.focus) === JSON.stringify(lead?.focus),
    );
    if (other) {
      conclusion.text += " " + other.text;
      conclusion.factIds = [
        ...new Set([...conclusion.factIds, ...other.factIds]),
      ];
    }
  }
  if (reversedPremise)
    conclusion.text =
      "提问中的费用与收入变化前提与当前数据不符。" + conclusion.text;
  if (!ready) conclusion.text += "进一步解释仍有证据缺口。";
  const keyEvidence: Finding[] = [];
  const covered = new Set<string>();
  for (const o of [
    lead,
    ...selected.filter((o) => o.kind === "contribution"),
    ...selected,
  ]) {
    if (
      !o ||
      keyEvidence.length >= 3 ||
      o.factIds.every((id) => covered.has(id))
    )
      continue;
    keyEvidence.push(finding(o));
    for (const id of o.factIds) covered.add(id);
  }
  if (!keyEvidence.length && fallback) keyEvidence.push(finding(conclusion));
  const followups = followupsFor(
    context,
    evidence,
    facts,
    conclusion,
    input.history,
    lead?.focus,
  );
  const dimensions = { channel: "渠道", device: "设备", region: "国家" };
  const explanations =
    context.taskKind === "why" ? explanationsFor(evidence, facts) : undefined;
  return {
    summary: conclusion.text,
    ...(explanations ? { explanations } : {}),
    conclusion,
    keyEvidence,
    followups,
    facts,
    findings: selected.slice(0, 6).map(finding),
    checkedExplanations: [
      ...new Set(
        evidence.map(
          (e) =>
            `${e.spec.mode === "cohort" ? `首访后${e.spec.windowDays}天` : "自然时期"}，${e.spec.groupBy.length ? "按" + e.spec.groupBy.map((d) => dimensions[d]).join(" / ") : "整体"}已核查：${e.spec.metrics.map((m) => LABELS[m]).join("、")}。`,
        ),
      ),
    ],
    limitations: [
      ...(!ready
        ? ["进一步解释尚未完全通过审查，当前只确认已查询到的观测变化。"]
        : []),
      ...(evidence.some((e) => e.coverage.some((c) => c.excludedUsers > 0))
        ? [
            "已排除随访不足的获客日期，费用同步裁剪；时期有效获客天数可能不同，不能把这些合计直接解释成完整月份的表现或被排除用户的表现。",
          ]
        : []),
      ...(explanations?.some((e) => e.status === "not_checked")
        ? [
            "尚未检查：" +
              explanations
                .filter((e) => e.status === "not_checked")
                .map((e) => e.claim)
                .join("；") +
              "。这些解释尚未排除。",
          ]
        : []),
      "渠道金额增减可相加；用户规模、付费比例与收入的关系只描述观测构成，不代表广告因果贡献。",
      ...catalog(context.datasetVersion, evidence[0]?.backend ?? "fixture")
        .limitations,
    ],
    nextSteps: followups.length
      ? followups.map((action) => action.message)
      : ["当前范围的这些检查已完成，可以指定新的时期或筛选条件继续分析。"],
  };
}
