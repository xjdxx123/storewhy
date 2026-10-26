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
        `${{ channels: "channel", devices: "device", regions: "country" }[key]}=${values.join("/")}`,
    );
  return `${goal}? Periods: ${spec.periods.map((p) => `${p.start} to ${p.end} (end exclusive)`).join(" and ")}; ${spec.mode === "cohort" ? `within ${spec.windowDays} days of first visit` : "calendar period"}; ${spec.audience === "paid" ? "paid-channel users" : "all users"}${filters.length ? "; " + filters.join("; ") : ""}.`;
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
      `Check purchasing behavior on ${channel}`,
      `Focus on ${channel} and compare purchaser rate and revenue per purchasing user`,
      "This channel appears in the conclusion evidence. Check its purchasing behavior next.",
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
      "Split first and subsequent purchase revenue",
      "Compare whether revenue changes come from first or subsequent purchases",
      "First and subsequent purchase revenue have not yet been separated in this scope.",
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
      "Check purchaser rate and revenue per purchaser",
      "Compare changes in purchaser rate and revenue per purchasing user",
      "Check purchaser rate and revenue per purchaser to locate the observed revenue change.",
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
      "Break down changes by channel",
      "Compare these metric changes by first observed channel",
      "A channel breakdown can locate changes within the current scope.",
      { ...base, groupBy: ["channel"] },
    );
  if (base.mode === "cohort") {
    const windowDays = base.windowDays === 14 ? 7 : 14;
    propose(
      "compare-window",
      `Check the first ${windowDays} days after first visit`,
      `Change the observation window to ${windowDays} days after first visit and check these metric changes`,
      "Use another complete follow-up window to check whether the conclusion depends on observation time.",
      { ...base, windowDays },
    );
  }
  // A monthly, ungrouped view stays within the 200-row bound. It explicitly changes the time basis.
  propose(
    "calendar-trend",
    "View calendar-month revenue trend",
    "Switch to calendar mode and inspect monthly revenue without grouping",
    "Calendar trends locate the change in time. This explicitly switches the time basis.",
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
