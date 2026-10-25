import { LABELS } from "./catalog.ts";
import type { Evidence, Fact, Finding, Metric } from "@storewhy/contracts";
import { AppError } from "../config.ts";
export interface Observation extends Finding {
  id: string;
  evidenceId: string;
  kind: "comparison" | "joint" | "coverage" | "snapshot";
}
export function observationsFor(
  evidence: Evidence[],
  facts: Fact[],
): Observation[] {
  const output: Observation[] = [];
  const add = (
    e: Evidence,
    kind: Observation["kind"],
    text: string,
    refs: Fact[],
  ) =>
    output.push({
      id: "o-" + output.length,
      evidenceId: e.id,
      kind,
      text,
      factIds: refs.map((f) => f.id),
    });
  const sign = (value: number) =>
    value > 0 ? "增加" : value < 0 ? "减少" : "不变";
  for (const e of evidence) {
    const bound = (metric: Metric, dimensions: object) =>
      facts.filter(
        (f) =>
          f.evidenceId === e.id &&
          f.metric === metric &&
          JSON.stringify(e.rows[f.rowIndex].dimensions) ===
            JSON.stringify(dimensions),
      );
    const segment = (dimensions: object) =>
      Object.values(dimensions).join(" / ") || "整体";
    const mode =
      e.spec.mode === "cohort" ? `首访后${e.spec.windowDays}天` : "自然时期";
    if (e.comparisons.length) {
      // Joint spend/income observations make the arithmetic explicit without claiming causality.
      const spend = e.comparisons
        .filter((c) => c.metric === "spend" && c.delta !== null)
        .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!));
      for (const c of spend.slice(0, 4)) {
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
              : "两者变化应结合各自分母与渠道结构判断。";
        add(
          e,
          "joint",
          `${segment(c.dimensions)}：${mode}口径下，费用${sign(c.delta!)}${Math.abs(c.delta!)}，收入${sign(r.delta!)}${Math.abs(r.delta!)}。${mismatch}这只是观测比较。`,
          [...bound("spend", c.dimensions), ...bound("revenue", c.dimensions)],
        );
      }
      for (const metric of e.spec.metrics) {
        const all = e.comparisons
          .filter((c) => c.metric === metric && c.delta !== null)
          .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!));
        for (const c of all.slice(0, e.spec.groupBy.length ? 2 : 1)) {
          const percent =
            c.relativeChange === null
              ? ""
              : `，变化率${(c.relativeChange * 100).toFixed(2)}%`;
          add(
            e,
            "comparison",
            `${segment(c.dimensions)}：${e.spec.periods[1].label}相较${e.spec.periods[0].label}，${mode}的 ${LABELS[metric]} 从${c.baseline}变为${c.current}，差额${c.delta}${percent}。`,
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
            `${row.period}${row.bucket ? " / " + row.bucket : ""}，${segment(row.dimensions)}：${mode}的 ${LABELS[metric]} 为${value}。`,
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
