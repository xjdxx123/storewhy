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
        ? "已查询，但缺少可配对的时期或可计算分母，不能判断变化。"
        : "尚未执行所需指标与拆分，不能支持或排除该解释。",
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
      "用户规模与收入同向变化",
    ],
    ["conversion", "payer_rate", "购买用户比例与收入同向变化"],
    ["purchase_value", "revenue_per_payer", "每位购买用户收入与总收入同向变化"],
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
          "这里只检验变化方向，不能据此认定因果或分摊收入贡献。",
        factIds: [...new Set(chosen.flatMap((o) => o.factIds))],
      };
    });
  }
  check(
    "repeat",
    "首次与后续购买收入能拆解已观测收入变化",
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
    "费用增加且收入增长未跟上费用增长",
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
            text: o.text + "该判断只核查费用与收入的观测前提。",
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
      claim: "所列渠道的收入变化存在差异",
      status:
        rows.length < 2 || !contribution
          ? "missing_data"
          : varied
            ? "supported"
            : "contradicted",
      text:
        contribution?.text ??
        "当前拆分不足两个可比较渠道，不能判断渠道间差异。",
      factIds: contribution?.factIds ?? [],
      evidenceIds: [grouped.id],
      coverageRefs: [],
    });
  } else
    output.push({
      id: "channel_mix",
      kind: "channel_mix",
      claim: "所列渠道的收入变化存在差异",
      status: "not_checked",
      text: "尚未完成多个渠道同口径收入变化的拆分，不能支持或排除渠道构成解释。",
      factIds: [],
      evidenceIds: [],
      coverageRefs: [],
    });
  const cohorts = usable.filter((e) => e.spec.mode === "cohort");
  output.push({
    id: "maturity",
    kind: "maturity",
    claim: "请求范围内所有用户均有完整随访",
    status: cohorts.length
      ? cohorts.some((e) => e.coverage.some((c) => c.excludedUsers > 0))
        ? "contradicted"
        : "supported"
      : "not_checked",
    text: cohorts.length
      ? cohorts.some((e) => e.coverage.some((c) => c.excludedUsers > 0))
        ? "请求包含随访不足用户，已排除这些获客日期，费用同步裁剪；结论仅适用于剩余完整观察窗口用户，不能证明被排除的新用户表现差。"
        : "当前获客批次已保留完整观察窗口；不能把剩余批次的变化归咎于随访不足，也不能推断更长窗口表现。"
      : "本轮使用自然时期，未检验新获客批次的完整随访。",
    factIds: [],
    evidenceIds: cohorts.map((e) => e.id),
    coverageRefs: cohorts.flatMap((e) =>
      e.coverage.map((c) => ({ evidenceId: e.id, period: c.period })),
    ),
  });
  return output;
}
