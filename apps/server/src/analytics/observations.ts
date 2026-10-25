import { Decimal } from "decimal.js";
import { LABELS, segmentLabel } from "./catalog.ts";
import type {
  Evidence,
  Fact,
  Finding,
  Metric,
  Dimension,
} from "@storewhy/contracts";
import { AppError } from "../config.ts";
export interface Observation extends Finding {
  id: string;
  evidenceId: string;
  kind:
    | "comparison"
    | "joint"
    | "contribution"
    | "composition"
    | "ratio"
    | "coverage"
    | "snapshot";
  metrics: Metric[];
  focus?: Partial<Record<Dimension, string>>;
}
const percentage = (value: number) => new Decimal(value).mul(100);
const percentageText = (value: number) =>
  percentage(value).toDecimalPlaces(2).toString() + "%";
const isProportion = (metric: Metric) =>
  metric === "payer_rate" || metric === "repeat_payer_rate";
const metricText = (metric: Metric, value: number) =>
  isProportion(metric) ? percentageText(value) : String(value);
function pointDelta(value: number) {
  const exact = percentage(value).abs(),
    rounded = exact.toDecimalPlaces(2);
  return (
    rounded.isZero() && !exact.isZero() ? exact.toSignificantDigits(2) : rounded
  ).toString();
}
export function observationsFor(
  evidence: Evidence[],
  facts: Fact[],
  options: { query?: boolean } = {},
): Observation[] {
  const output: Observation[] = [];
  const add = (
    e: Evidence,
    kind: Observation["kind"],
    text: string,
    refs: Fact[],
    focus?: Partial<Record<Dimension, string>>,
  ) =>
    output.push({
      id: "o-" + output.length,
      evidenceId: e.id,
      kind,
      text,
      factIds: refs.map((f) => f.id),
      metrics: [...new Set(refs.map((f) => f.metric))],
      ...(focus
        ? { focus }
        : refs.length && e.rows[refs[0].rowIndex]
          ? { focus: e.rows[refs[0].rowIndex].dimensions }
          : {}),
    });
  const sign = (value: number) =>
    value > 0 ? "增加" : value < 0 ? "减少" : "不变";
  for (const e of evidence) {
    const segment = (dimensions: Partial<Record<Dimension, string>>) =>
      segmentLabel(dimensions, e.spec.filters);
    const bound = (metric: Metric, dimensions: object) =>
      facts.filter(
        (f) =>
          f.evidenceId === e.id &&
          f.metric === metric &&
          JSON.stringify(e.rows[f.rowIndex].dimensions) ===
            JSON.stringify(dimensions),
      );
    const mode =
      e.spec.mode === "cohort" ? `首访后${e.spec.windowDays}天` : "自然时期";
    if (e.comparisons.length) {
      if (
        !options.query &&
        ["revenue", "first_purchase_revenue", "repeat_purchase_revenue"].every(
          (m) => e.spec.metrics.includes(m as Metric),
        )
      ) {
        for (const r of e.comparisons
          .filter((c) => c.metric === "revenue" && c.delta !== null)
          .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))
          .slice(0, 4)) {
          const parts = [
            "first_purchase_revenue",
            "repeat_purchase_revenue",
          ].map((metric) =>
            e.comparisons.find(
              (c) =>
                c.metric === metric &&
                JSON.stringify(c.dimensions) === JSON.stringify(r.dimensions),
            ),
          );
          if (parts.some((c) => !c || c.delta === null)) continue;
          const [first, repeat] = parts;
          if (
            new Decimal(first!.delta!)
              .plus(repeat!.delta!)
              .minus(r.delta!)
              .abs()
              .greaterThan(0.02)
          )
            continue;
          add(
            e,
            "composition",
            `${segment(r.dimensions)}：${e.spec.periods[1].label}对比${e.spec.periods[0].label}，${mode}收入${sign(r.delta!)}${Math.abs(r.delta!)}；首次购买收入${sign(first!.delta!)}${Math.abs(first!.delta!)}，后续购买收入${sign(repeat!.delta!)}${Math.abs(repeat!.delta!)}。首次与后续是收入构成，不等同于新客与老客。`,
            [
              ...bound("revenue", r.dimensions),
              ...bound("first_purchase_revenue", r.dimensions),
              ...bound("repeat_purchase_revenue", r.dimensions),
            ],
          );
        }
      }
      // Joint spend/income observations make the arithmetic explicit without claiming causality.
      const spend = e.comparisons
        .filter((c) => c.metric === "spend" && c.delta !== null)
        .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!));
      for (const c of options.query ? [] : spend.slice(0, 4)) {
        const r = e.comparisons.find(
          (other) =>
            other.metric === "revenue" &&
            JSON.stringify(other.dimensions) === JSON.stringify(c.dimensions),
        );
        if (
          r?.delta === null ||
          !r ||
          c.baseline === null ||
          c.current === null
        )
          continue;
        const mismatch =
          c.delta! > 0 && r.delta! <= 0
            ? "费用增加没有伴随同口径收入增加。"
            : c.relativeChange !== null &&
                r.relativeChange !== null &&
                c.relativeChange > r.relativeChange
              ? "收入变化率低于费用变化率。"
              : "";
        add(
          e,
          "joint",
          `${segment(c.dimensions)}：${e.spec.periods[1].label}对比${e.spec.periods[0].label}，${mode}口径下，费用${sign(c.delta!)}${Math.abs(c.delta!)}，收入${sign(r.delta!)}${Math.abs(r.delta!)}。${mismatch}`,
          [...bound("spend", c.dimensions), ...bound("revenue", c.dimensions)],
        );
      }
      // Ratios of complete channel totals must use amounts, never an average of channel ratios.
      if (
        !options.query &&
        !e.truncated &&
        e.spec.groupBy.length === 1 &&
        e.spec.groupBy[0] === "channel" &&
        e.spec.periods.length === 2
      ) {
        const [before, after] = e.spec.periods.map((p) =>
          e.rows.filter((row) => row.period === p.label),
        );
        const complete =
          before.length > 1 &&
          before.length === after.length &&
          before.every((row) =>
            after.some(
              (other) => other.dimensions.channel === row.dimensions.channel,
            ),
          ) &&
          [...before, ...after].every(
            (row) =>
              row.values.spend !== null &&
              row.values.spend !== undefined &&
              row.values.revenue !== null &&
              row.values.revenue !== undefined,
          );
        if (complete) {
          const totals = [before, after].map((rows) => ({
            spend: rows.reduce(
              (s, r) => s.plus(r.values.spend!),
              new Decimal(0),
            ),
            revenue: rows.reduce(
              (s, r) => s.plus(r.values.revenue!),
              new Decimal(0),
            ),
          }));
          if (totals.every((t) => t.spend.greaterThan(0))) {
            const [base, current] = totals.map((t) =>
              t.revenue.div(t.spend).toDecimalPlaces(6),
            );
            const costDelta = totals[1].spend.minus(totals[0].spend).toNumber(),
              revenueDelta = totals[1].revenue
                .minus(totals[0].revenue)
                .toNumber();
            add(
              e,
              "ratio",
              `所列渠道合计：${e.spec.periods[1].label}对比${e.spec.periods[0].label}，${mode}的收入与记录费用比从${base}变为${current}；费用${sign(costDelta)}${Math.abs(costDelta)}，收入${sign(revenueDelta)}${Math.abs(revenueDelta)}。比值由渠道金额合计计算，不是渠道比值平均，也不代表广告因果增量。`,
              facts.filter(
                (f) =>
                  f.evidenceId === e.id &&
                  (f.metric === "spend" || f.metric === "revenue"),
              ),
              {},
            );
          }
        }
      }
      // Add only complete, additive channel amounts. Rates and cross factors are never summed.
      if (
        !options.query &&
        !e.truncated &&
        e.spec.groupBy.length === 1 &&
        e.spec.groupBy[0] === "channel"
      ) {
        for (const metric of ["spend", "revenue"] as const) {
          const changes = e.comparisons.filter((c) => c.metric === metric);
          if (changes.length < 2 || changes.some((c) => c.delta === null))
            continue;
          const lead = [...changes].sort(
            (a, b) => Math.abs(b.delta!) - Math.abs(a.delta!),
          )[0];
          const net = changes.reduce(
            (sum, c) => sum.plus(c.delta!),
            new Decimal(0),
          );
          const rest = net.minus(lead.delta!).toDecimalPlaces(6).toNumber();
          add(
            e,
            "contribution",
            `${e.spec.periods[1].label}对比${e.spec.periods[0].label}，${mode}的${LABELS[metric]}：${segment(lead.dimensions)}${sign(lead.delta!)}${Math.abs(lead.delta!)}，其余所列渠道合计${sign(rest)}${Math.abs(rest)}，所列渠道合计${sign(net.toNumber())}${net.abs().toNumber()}。`,
            facts.filter((f) => f.evidenceId === e.id && f.metric === metric),
            lead.dimensions,
          );
        }
      }
      for (const metric of e.spec.metrics) {
        const all = e.comparisons
          .filter((c) => c.metric === metric && c.delta !== null)
          .sort((a, b) =>
            options.query
              ? b.delta! - a.delta!
              : Math.abs(b.delta!) - Math.abs(a.delta!),
          );
        const candidates =
          options.query && all.length > 1
            ? [all[0], all.at(-1)!]
            : all.slice(0, e.spec.groupBy.length ? 2 : 1);
        for (const c of candidates) {
          const percent =
            c.relativeChange === null || isProportion(metric)
              ? ""
              : `，变化率${(c.relativeChange * 100).toFixed(2)}%`;
          add(
            e,
            "comparison",
            `${segment(c.dimensions)}：${e.spec.periods[1].label}相较${e.spec.periods[0].label}，${mode}的 ${LABELS[metric]} 从${metricText(metric, c.baseline!)}变为${metricText(metric, c.current!)}，${isProportion(metric) ? `${sign(c.delta!)}${pointDelta(c.delta!)}个百分点` : `差额${c.delta}`}${percent}。`,
            bound(metric, c.dimensions),
          );
        }
      }
    } else {
      // Snapshot/trend observations always refer to actual rows, never interpolated dates.
      const rows =
        e.rows.length > 12
          ? [...e.rows.slice(0, 6), ...e.rows.slice(-6)]
          : e.rows;
      for (const row of rows)
        for (const metric of e.spec.metrics.slice(0, 3)) {
          const ri = e.rows.indexOf(row),
            value = row.values[metric];
          if (value === null || value === undefined) continue;
          add(
            e,
            "snapshot",
            `${row.period}${row.bucket ? " / " + row.bucket : ""}，${segment(row.dimensions)}：${mode}的 ${LABELS[metric]} 为${metricText(metric, value)}。`,
            facts.filter(
              (f) =>
                f.evidenceId === e.id &&
                f.rowIndex === ri &&
                f.metric === metric,
            ),
          );
        }
    }
    if (e.coverage.some((c) => c.excludedUsers > 0))
      add(
        e,
        "coverage",
        "已排除随访不足的获客日期，费用同步裁剪；结论仅适用于剩余完整观察窗口的用户。",
        facts.filter((f) => f.evidenceId === e.id).slice(0, 1),
      );
  }
  return output;
}
export function validateSelection(ids: string[], observations: Observation[]) {
  const allowed = new Set(observations.map((o) => o.id));
  if (ids.some((id) => !allowed.has(id)))
    throw new AppError(
      "UNBOUND_OBSERVATION",
      "调查引用了不存在的观测证据",
      503,
    );
  return [...new Set(ids)].map((id) => observations.find((o) => o.id === id)!);
}
