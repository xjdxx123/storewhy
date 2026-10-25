import { createHash, randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import {
  type AnalysisSpec,
  type Evidence,
  type AnalysisRow,
  type Metric,
  type Comparison,
  METRIC_VERSION,
} from "@storewhy/contracts";
import { type SqlBackend } from "../integrations/zetaris.ts";
import { compilePeriod, validateSpec } from "./compiler.ts";
import { DEFINITIONS } from "./catalog.ts";
import { AppError } from "../config.ts";
const n = (v: unknown) => {
  const x = Number(v ?? 0);
  if (!Number.isFinite(x))
    throw new AppError("INVALID_NUMBER", "查询包含不可计算数值", 503);
  return x;
};
const money = (v: unknown) => {
  const x = new Decimal(String(v ?? 0));
  if (!x.isFinite() || x.abs().greaterThan("1000000000000"))
    throw new AppError("UNSAFE_MONEY", "金额超出支持范围", 503);
  return x.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
};
const ratio = (a: number, b: number | null) =>
  b === null || b === 0
    ? null
    : new Decimal(a).div(b).toDecimalPlaces(6).toNumber();
export function values(
  row: Record<string, unknown>,
): Record<Metric, number | null> {
  const users = n(row.n_users),
    nu = n(row.n_new),
    payers = n(row.n_payers),
    revenue = money(row.revenue_amount),
    spend =
      row.spend_amount === null || row.spend_amount === undefined
        ? null
        : money(row.spend_amount);
  return {
    spend,
    sessions: n(row.n_sessions),
    users,
    new_users: nu,
    payers,
    purchases: n(row.n_purchases),
    revenue,
    first_purchase_revenue: money(row.first_amount),
    repeat_purchase_revenue: money(row.repeat_amount),
    payer_rate: ratio(payers, users),
    revenue_per_user: ratio(revenue, users),
    revenue_per_payer: ratio(revenue, payers),
    repeat_payer_rate: ratio(n(row.n_repeat_payers), payers),
    cost_per_new_user: spend === null ? null : ratio(spend, nu),
    revenue_to_spend: ratio(revenue, spend),
    avg_first_purchase_hours:
      row.first_hours === null || row.first_hours === undefined
        ? null
        : new Decimal(n(row.first_hours)).toDecimalPlaces(6).toNumber(),
  };
}
export class Analytics {
  constructor(
    readonly backend: SqlBackend,
    readonly datasetVersion: string,
    readonly prefix = backend.kind === "zetaris" ? "storewhy" : "public",
  ) {}
  async query(input: unknown, signal?: AbortSignal): Promise<Evidence> {
    const spec = validateSpec(input);
    const start = Date.now();
    const rows: AnalysisRow[] = [];
    const sql: string[] = [];
    const queryIds: string[] = [];
    const coverage: Evidence["coverage"] = [];
    for (const period of spec.periods) {
      const compiled = compilePeriod(spec, period, this.prefix);
      const result = await this.backend.execute(compiled.sql, signal);
      sql.push(compiled.sql);
      queryIds.push(result.queryId);
      if (result.truncated || result.rows.length >= 201)
        throw new AppError(
          "RESULT_TRUNCATED",
          "结果超出完整覆盖限制，请缩小范围",
          422,
        );
      for (const row of result.rows) {
        const required = [
          "n_users",
          "n_new",
          "n_payers",
          "n_repeat_payers",
          "n_purchases",
          "revenue_amount",
          "first_amount",
          "repeat_amount",
          "first_hours",
          "n_sessions",
          "spend_amount",
        ];
        if (required.some((column) => !Object.hasOwn(row, column)))
          throw new AppError(
            "RESULT_SCHEMA",
            "查询结果缺少预期字段，拒绝以零代替",
            503,
          );
        const all = values(row);
        rows.push({
          period: period.label,
          ...(spec.timeGrain ? { bucket: String(row.bucket) } : {}),
          dimensions: Object.fromEntries(
            spec.groupBy.map((d) => [d, String(row[d])]),
          ),
          values: Object.fromEntries(spec.metrics.map((m) => [m, all[m]])),
        });
      }
      if (rows.length > 200)
        throw new AppError(
          "RESULT_TRUNCATED",
          "合并结果超过两百行，请缩小范围",
          422,
        );
      let excludedUsers = 0;
      if (compiled.excludedSql) {
        const ex = await this.backend.execute(compiled.excludedSql, signal);
        sql.push(compiled.excludedSql);
        queryIds.push(ex.queryId);
        if (
          ex.truncated ||
          ex.rows.length !== 1 ||
          !Object.hasOwn(ex.rows[0], "n")
        )
          throw new AppError("RESULT_SCHEMA", "无法核对排除用户数", 503);
        excludedUsers = n(ex.rows[0].n);
      }
      coverage.push({
        period: period.label,
        requestedStart: period.start,
        requestedEnd: period.end,
        effectiveEnd: compiled.end,
        excludedUsers,
        days: (Date.parse(compiled.end) - Date.parse(period.start)) / 86400000,
      });
    }
    const comparisons: Comparison[] = [];
    if (spec.periods.length === 2 && !spec.timeGrain) {
      const [first, second] = spec.periods;
      const segments = new Map(
        rows.map((row) => [JSON.stringify(row.dimensions), row.dimensions]),
      );
      for (const dimensions of segments.values()) {
        const find = (label: string) =>
          rows.find(
            (row) =>
              row.period === label &&
              JSON.stringify(row.dimensions) === JSON.stringify(dimensions),
          );
        const before = find(first.label),
          after = find(second.label);
        for (const metric of spec.metrics) {
          const baseline = before?.values[metric] ?? null,
            current = after?.values[metric] ?? null;
          const delta =
            baseline === null || current === null
              ? null
              : new Decimal(current)
                  .minus(baseline)
                  .toDecimalPlaces(6)
                  .toNumber();
          comparisons.push({
            dimensions,
            metric,
            baseline,
            current,
            delta,
            relativeChange:
              delta === null || baseline === null || baseline === 0
                ? null
                : new Decimal(delta)
                    .div(baseline)
                    .toDecimalPlaces(6)
                    .toNumber(),
          });
        }
      }
    }
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          spec,
          datasetVersion: this.datasetVersion,
          metricVersion: METRIC_VERSION,
        }),
      )
      .digest("hex");
    return {
      id: "ev-" + randomUUID(),
      datasetVersion: this.datasetVersion,
      metricVersion: METRIC_VERSION,
      spec,
      sql,
      queryIds,
      comparisons,
      backend: this.backend.kind,
      rows,
      coverage,
      definitions: Object.fromEntries(
        spec.metrics.map((m) => [m, DEFINITIONS[m]]),
      ),
      notes: [
        "归属采用首次观测渠道/设备/国家；这是观测比较，不是广告因果增量或利润。",
        "时间为源数据原始时间，金额单位未标注。",
        ...(spec.audience === "all" &&
        spec.metrics.some((m) =>
          ["spend", "revenue_to_spend", "cost_per_new_user"].includes(m),
        )
          ? [
              "整体收入可能包含 organic 收入；记录费用仅来自付费渠道，整体收入/费用不能解释为广告增量或 organic 回报。",
            ]
          : []),
        ...(coverage.some((c) => c.excludedUsers > 0)
          ? ["已排除随访不足用户，并将费用裁剪到相同获客日期。"]
          : []),
        "spec:" + fingerprint,
      ],
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      truncated: false,
    };
  }
}
export function specKey(spec: AnalysisSpec) {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}
