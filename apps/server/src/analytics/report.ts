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
  const compositionQuestion =
    /首次.*(?:后续|复购)|first.*(?:repeat|subsequent)/i.test(objective);
  const revenueQuestion =
    /收入|revenue/i.test(objective.split(/[？?；;]/)[0]) &&
    !/比例.*收入|比率.*收入/.test(objective);
  const payerRateQuestion =
    /购买用户比例|付费比例|purchaser rate|payer rate/i.test(objective);
  const relevant = ratioQuestion
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
      : payerRateQuestion
        ? (selected.find(
            (o) => o.kind === "comparison" && o.metrics.includes("payer_rate"),
          ) ??
          observations.find(
            (o) => o.kind === "comparison" && o.metrics.includes("payer_rate"),
          ))
        : input.selected &&
            revenueQuestion &&
            !observations.some((o) => o.kind === "joint")
          ? (selected.find(
              (o) => o.kind === "comparison" && o.metrics.includes("revenue"),
            ) ??
            observations.find(
              (o) => o.kind === "comparison" && o.metrics.includes("revenue"),
            ))
          : undefined;
  const reversedPremise =
    /费用(?:增加|更多|上升)|(?:广告费|费用).*增|spend.*(?:increas|grew|ris|rose)|(?:higher|more).*spend/i.test(
      objective,
    ) &&
    /收入.*(?:减少|下降|没有|未)|revenue.*(?:decreas|declin|fell|flat|not|fail|lag)|(?:lower|less).*revenue/i.test(
      objective,
    )
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
  const focusedFallback =
    headline?.kind === "joint" &&
    !Object.keys(headline.focus ?? {}).length &&
    revenueQuestion &&
    context.spec.metrics.includes("spend")
      ? (selected.find(
          (o) => o.kind === "joint" && Object.keys(o.focus ?? {}).length,
        ) ??
        observations.find(
          (o) => o.kind === "joint" && Object.keys(o.focus ?? {}).length,
        ))
      : undefined;
  const lead =
    reversedPremise ??
    relevant ??
    focusedFallback ??
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
          text: `${fallback.label} is ${fallback.value}.`,
          factIds: [fallback.id],
        }
      : {
          text: "No calculable values are available in the current scope.",
          factIds: [],
        };
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
      "The assumed spend and revenue changes do not match the current data. " +
      conclusion.text;
  if (!ready)
    conclusion.text += " Further explanation still has evidence gaps.";
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
  const dimensions = {
    channel: "channel",
    device: "device",
    region: "country",
  };
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
            `${e.spec.mode === "cohort" ? `Within ${e.spec.windowDays} days of first visit` : "Calendar period"}, ${e.spec.groupBy.length ? "by " + e.spec.groupBy.map((d) => dimensions[d]).join(" / ") : "overall"}: checked ${e.spec.metrics.map((m) => LABELS[m]).join(", ")}.`,
        ),
      ),
    ],
    limitations: [
      ...(!ready
        ? [
            "Further explanation has not fully passed review. Only the queried observational changes are confirmed.",
          ]
        : []),
      ...(evidence.some((e) => e.coverage.some((c) => c.excludedUsers > 0))
        ? [
            "Acquisition dates without complete follow-up and their matching spend were excluded. Effective acquisition days may differ; these totals do not describe full months or excluded users.",
          ]
        : []),
      ...(explanations?.some((e) => e.status === "not_checked")
        ? [
            "Not checked: " +
              explanations
                .filter((e) => e.status === "not_checked")
                .map((e) => e.claim)
                .join("; ") +
              ". These explanations have not been ruled out.",
          ]
        : []),
      "Channel amount changes are additive. Relationships between user volume, purchaser rate and revenue describe observed composition, not causal ad contributions.",
      ...catalog(context.datasetVersion, evidence[0]?.backend ?? "fixture")
        .limitations,
    ],
    nextSteps: followups.length
      ? followups.map((action) => action.message)
      : [
          "These checks are complete for the current scope. Choose new dates or filters to continue.",
        ],
  };
}
