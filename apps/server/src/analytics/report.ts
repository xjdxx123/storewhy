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
  const lead =
    selected.find((o) => o.id === input.headlineObservationId) ??
    selected.find(
      (o) => o.kind === "joint" && Object.keys(o.focus ?? {}).length > 0,
    ) ??
    selected.find((o) => o.kind === "joint") ??
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
  return {
    summary: conclusion.text,
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
      "渠道金额增减可相加；用户规模、付费比例与收入的关系只描述观测构成，不代表广告因果贡献。",
      ...catalog(context.datasetVersion, evidence[0]?.backend ?? "fixture")
        .limitations,
    ],
    nextSteps: followups.length
      ? followups.map((action) => action.message)
      : ["当前范围的这些检查已完成，可以指定新的时期或筛选条件继续分析。"],
  };
}
