import type { Evidence, Explanation, Fact, Metric } from "@storewhy/contracts";
import { observationsFor } from "./observations.ts";

/** These are observational checks. Model-selected hypotheses are never treated as verified facts. */
export function explanationsFor(
  evidence: Evidence[],
  facts: Fact[],
): Explanation[] {
  const usable = evidence.filter((e) => !e.truncated);
  const observations = observationsFor(usable, facts);
  const output: Explanation[] = [];
  function check(
    kind: Explanation["kind"],
    claim: string,
    metrics: Metric[],
    evaluate: (
      e: Evidence,
    ) => Pick<Explanation, "status" | "text" | "factIds"> | undefined,
  ) {
    const candidates = usable.filter((e) =>
      metrics.every((m) => e.spec.metrics.includes(m)),
    );
    for (const e of candidates) {
      const result = evaluate(e);
      if (result) {
        output.push({
          id: kind,
          kind,
          claim,
          ...result,
          evidenceIds: [e.id],
          coverageRefs: [],
        });
        return;
      }
    }
    output.push({
      id: kind,
      kind,
      claim,
      status: candidates.length ? "missing_data" : "not_checked",
      text: candidates.length
        ? "Queried, but matching periods or calculable denominators are missing. The change cannot be assessed."
        : "The required metrics and breakdowns have not been queried. This explanation cannot yet be supported or ruled out.",
      factIds: [],
      evidenceIds: candidates.map((e) => e.id),
      coverageRefs: [],
    });
  }
  for (const [kind, metric, claim] of [
    [
      "traffic",
      usable.some(
        (e) =>
          e.spec.metrics.includes("users") &&
          e.spec.metrics.includes("revenue"),
      )
        ? "users"
        : "new_users",
      "User volume and revenue move in the same direction",
    ],
    [
      "conversion",
      "payer_rate",
      "Purchaser rate and revenue move in the same direction",
    ],
    [
      "purchase_value",
      "revenue_per_payer",
      "Revenue per purchaser and total revenue move in the same direction",
    ],
  ] as const) {
    check(kind, claim, [metric, "revenue"], (e) => {
      const pairs = e.comparisons
        .filter((c) => c.metric === "revenue" && c.delta !== null)
        .map((r) => ({
          r,
          f: e.comparisons.find(
            (c) =>
              c.metric === metric &&
              JSON.stringify(c.dimensions) === JSON.stringify(r.dimensions) &&
              c.delta !== null,
          ),
        }))
        .filter((p) => p.f)
        .sort((a, b) => Math.abs(b.r.delta!) - Math.abs(a.r.delta!));
      const pair = pairs[0];
      if (!pair) return;
      const { r, f } = pair;
      const chosen = observationsFor(
        [
          {
            ...e,
            comparisons: e.comparisons.filter(
              (c) =>
                JSON.stringify(c.dimensions) === JSON.stringify(r.dimensions),
            ),
          },
        ],
        facts,
      ).filter(
        (o) =>
          o.kind === "comparison" &&
          (o.metrics.includes(metric) || o.metrics.includes("revenue")),
      );
      if (
        !chosen.some((o) => o.metrics.includes(metric)) ||
        !chosen.some((o) => o.metrics.includes("revenue"))
      )
        return;
      const same =
        r.delta! !== 0 && Math.sign(r.delta!) === Math.sign(f!.delta!);
      return {
        status: same ? "supported" : "contradicted",
        text:
          chosen.map((o) => o.text).join(" ") +
          " Only the direction of change is checked; this does not establish causality or allocate revenue contributions.",
        factIds: [...new Set(chosen.flatMap((o) => o.factIds))],
      };
    });
  }
  check(
    "repeat",
    "First and subsequent purchases explain the observed revenue composition",
    ["revenue", "first_purchase_revenue", "repeat_purchase_revenue"],
    (e) => {
      const all = e.comparisons
        .filter((c) => c.metric === "revenue" && c.delta !== null)
        .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!));
      for (const r of all) {
        const chosen = observations.filter(
          (o) =>
            o.evidenceId === e.id &&
            o.kind === "composition" &&
            JSON.stringify(o.focus) === JSON.stringify(r.dimensions),
        );
        if (chosen.length)
          return {
            status: "supported",
            text: chosen[0].text,
            factIds: chosen[0].factIds,
          };
      }
    },
  );
  check(
    "spend_efficiency",
    "Spend increased and revenue growth did not keep pace",
    ["spend", "revenue"],
    (e) => {
      const costs = e.comparisons
        .filter((c) => c.metric === "spend" && c.delta !== null)
        .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!));
      for (const c of costs) {
        const r = e.comparisons.find(
          (r) =>
            r.metric === "revenue" &&
            r.delta !== null &&
            JSON.stringify(r.dimensions) === JSON.stringify(c.dimensions),
        );
        if (!r || c.relativeChange === null || r.relativeChange === null)
          continue;
        const o = observations.find(
          (o) =>
            o.evidenceId === e.id &&
            o.kind === "joint" &&
            JSON.stringify(o.focus) === JSON.stringify(c.dimensions),
        );
        if (o)
          return {
            status:
              c.delta! > 0 && r.relativeChange < c.relativeChange
                ? "supported"
                : "contradicted",
            text:
              o.text +
              " This only checks the observed spend and revenue premise.",
            factIds: o.factIds,
          };
      }
    },
  );
  const grouped = usable.find(
    (e) =>
      e.spec.groupBy.length === 1 &&
      e.spec.groupBy[0] === "channel" &&
      e.comparisons.some((c) => c.metric === "revenue" && c.delta !== null),
  );
  if (grouped) {
    const rows = grouped.comparisons.filter(
      (c) => c.metric === "revenue" && c.delta !== null,
    );
    const varied = new Set(rows.map((c) => c.delta)).size > 1;
    const contribution = observations.find(
      (o) =>
        o.evidenceId === grouped.id &&
        o.kind === "contribution" &&
        o.metrics.includes("revenue"),
    );
    output.push({
      id: "channel_mix",
      kind: "channel_mix",
      claim: "Revenue changes differ across the listed channels",
      status:
        rows.length < 2 || !contribution
          ? "missing_data"
          : varied
            ? "supported"
            : "contradicted",
      text:
        contribution?.text ??
        "Fewer than two comparable channels are available, so differences cannot be assessed.",
      factIds: contribution?.factIds ?? [],
      evidenceIds: [grouped.id],
      coverageRefs: [],
    });
  } else
    output.push({
      id: "channel_mix",
      kind: "channel_mix",
      claim: "Revenue changes differ across the listed channels",
      status: "not_checked",
      text: "A comparable multi-channel revenue breakdown has not been completed. Channel composition cannot yet be supported or ruled out.",
      factIds: [],
      evidenceIds: [],
      coverageRefs: [],
    });
  const cohorts = usable.filter((e) => e.spec.mode === "cohort");
  output.push({
    id: "maturity",
    kind: "maturity",
    claim: "All users in the requested scope have complete follow-up",
    status: cohorts.length
      ? cohorts.some((e) => e.coverage.some((c) => c.excludedUsers > 0))
        ? "contradicted"
        : "supported"
      : "not_checked",
    text: cohorts.length
      ? cohorts.some((e) => e.coverage.some((c) => c.excludedUsers > 0))
        ? "The request includes users without complete follow-up. Their acquisition dates and matching spend were excluded. Findings apply only to retained mature cohorts and do not show that excluded users perform poorly."
        : "The retained acquisition cohorts have complete follow-up. Their changes cannot be attributed to incomplete follow-up, and longer-window performance cannot be inferred."
      : "This run uses calendar periods; completeness of new-user cohort follow-up was not checked.",
    factIds: [],
    evidenceIds: cohorts.map((e) => e.id),
    coverageRefs: cohorts.flatMap((e) =>
      e.coverage.map((c) => ({ evidenceId: e.id, period: c.period })),
    ),
  });
  return output;
}
