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
        `${{ channels: "Channel", devices: "Device", regions: "Country" }[key]}=${values.join("/")}`,
    );
  return `${goal}? Period: ${spec.periods.map((p) => `${p.start} to ${p.end} (end exclusive)`).join(" vs ")}; ${spec.mode === "cohort" ? `first ${spec.windowDays} days after the initial visit` : "calendar period"}; ${spec.audience === "paid" ? "paid-channel users" : "all users"}${filters.length ? "; " + filters.join("; ") : ""}.`;
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
      `Check ${channel} purchaser performance`,
      `Focus on ${channel} and compare purchaser rate with revenue per purchaser`,
      "This channel appears in the conclusion evidence and can be examined further.",
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
      "Split first and repeat revenue",
      "Compare whether the revenue change came from first or repeat purchases",
      "First- and repeat-purchase revenue have not yet been separated for this scope.",
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
      "Check purchaser rate and value",
      "Compare changes in purchaser rate and revenue per purchaser",
      "Add purchaser rate and revenue per purchaser to locate the source of the revenue change.",
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
      "Break the change down by channel",
      "Compare these metrics by first-observed channel",
      "A channel breakdown can locate the change within the current scope.",
      { ...base, groupBy: ["channel"] },
    );
  if (base.mode === "cohort") {
    const windowDays = base.windowDays === 14 ? 7 : 14;
    propose(
      "compare-window",
      `Check a ${windowDays}-day window`,
      `Use the first ${windowDays} days after the initial visit to check these metrics`,
      "Use another complete observation window to test whether the conclusion depends on window length.",
      { ...base, windowDays },
    );
  }
  // A monthly, ungrouped view stays within the 200-row bound. It explicitly changes the time basis.
  propose(
    "calendar-trend",
    "View the monthly revenue trend",
    "Switch to a calendar-period monthly revenue trend with no grouping",
    "A calendar-period trend shows when the change occurred and explicitly changes the time basis.",
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
