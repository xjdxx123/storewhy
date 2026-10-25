import {
  analysisSpecSchema,
  type AnalysisSpec,
  type Dimension,
} from "@storewhy/contracts";
import { compileTrend } from "./trend.ts";
import { AppError } from "../config.ts";
import { CHANNELS, DEVICES, REGIONS, COST_METRICS } from "./catalog.ts";
export const quote = (v: string) => "'" + v.replaceAll("'", "''") + "'";
export const stamp = (v: string) => `CAST(${quote(v)} AS TIMESTAMP)`;
export const dateOnly = (v: string) => `CAST(${quote(v)} AS DATE)`;
export function validateSpec(input: unknown): AnalysisSpec {
  const spec = analysisSpecSchema.parse(input);
  if (spec.timeGrain && spec.mode !== "calendar")
    throw new AppError(
      "TREND_MODE",
      "趋势查询使用自然时期 calendar 口径，请先明确时间口径",
    );
  if (new Set(spec.groupBy).size !== spec.groupBy.length)
    throw new AppError("DUPLICATE_DIMENSION", "不能重复拆分维度");
  if (new Set(spec.periods.map((p) => p.label)).size !== spec.periods.length)
    throw new AppError("DUPLICATE_PERIOD", "比较时期标签必须不同");
  for (const p of spec.periods)
    if (p.start < "2019-05-01" || p.end > "2019-11-01")
      throw new AppError(
        "DATE_OUT_OF_RANGE",
        "样例只覆盖 2019-05-01 至 2019-10-31，请指定该范围内日期",
      );
  for (const [values, allowed] of [
    [spec.filters.channels, CHANNELS],
    [spec.filters.devices, DEVICES],
    [spec.filters.regions, REGIONS],
  ] as const)
    for (const value of values)
      if (!allowed.includes(value))
        throw new AppError("UNKNOWN_FILTER", "数据中没有该筛选值：" + value);
  if (
    spec.metrics.some((m) => COST_METRICS.includes(m)) &&
    (spec.groupBy.some((d) => d === "device" || d === "region") ||
      spec.filters.devices.length ||
      spec.filters.regions.length)
  )
    throw new AppError(
      "COST_GRAIN_UNAVAILABLE",
      "费用只有渠道×日期粒度，无法按设备或国家计算。可以改为比较付费比例或用户收入。",
    );
  if (
    spec.metrics.some((m) => COST_METRICS.includes(m)) &&
    spec.filters.channels.includes("organic")
  )
    throw new AppError(
      "ORGANIC_COST_UNAVAILABLE",
      "organic 未提供费用，不能计算它的广告费用或回报比。",
    );
  return spec;
}
export function effectiveEnd(spec: AnalysisSpec, end: string): string {
  if (spec.mode === "calendar") return end;
  const cutoff = new Date("2019-11-01T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - spec.windowDays);
  return [end, cutoff.toISOString().slice(0, 10), "2019-10-28"].sort()[0];
}
export function filters(spec: AnalysisSpec, alias = "u"): string {
  const f: string[] = [];
  if (spec.audience === "paid") f.push(`${alias}.channel <> 'organic'`);
  for (const [key, col] of [
    ["channels", "channel"],
    ["devices", "device"],
    ["regions", "region"],
  ] as const)
    if (spec.filters[key].length)
      f.push(`${alias}.${col} IN (${spec.filters[key].map(quote).join(",")})`);
  return f.length ? f.join(" AND ") : "1=1";
}
export function compilePeriod(
  spec: AnalysisSpec,
  period: AnalysisSpec["periods"][number],
  prefix: string,
): { sql: string; excludedSql?: string; end: string } {
  if (spec.timeGrain)
    return { sql: compileTrend(spec, period, prefix), end: period.end };
  const end = effectiveEnd(spec, period.end);
  if (end <= period.start)
    throw new AppError(
      "IMMATURE_COHORT",
      "该时期还没有完整的 " +
        spec.windowDays +
        " 天随访，请选择更早获客日期或较短窗口",
    );
  const dims = spec.groupBy;
  const selectDims = (a: string) =>
    dims
      .map((d) => `${a}.${d} AS ${d}`)
      .concat(["'__all' AS segment"])
      .join(", ");
  const keys = dims.concat([]).concat([]) as Dimension[];
  const group = [...keys, "segment"].join(", ");
  const selectKeys = (a: string) =>
    [...keys.map((d) => `${a}.${d}`), `${a}.segment`].join(", ");
  const joinKeys = (a: string, b: string) =>
    [
      ...keys.map((d) => `${a}.${d}=${b}.${d}`),
      `${a}.segment=${b}.segment`,
    ].join(" AND ");
  const fields = filters(spec);
  const ts = (col: string) =>
    `${col} >= ${stamp(period.start)} AND ${col} < ${stamp(end)}`;
  const activity = `activity AS (SELECT user_id FROM ${prefix}.visits WHERE ${ts("started_at")} UNION SELECT user_id FROM ${prefix}.purchases WHERE ${ts("purchased_at")})`;
  const pop = `population AS (SELECT u.* FROM ${prefix}.profiles u ${spec.mode === "calendar" ? "JOIN activity a ON a.user_id=u.user_id" : ""} WHERE ${fields} ${spec.mode === "cohort" ? "AND " + ts("u.first_seen") : ""})`;
  const pTime =
    spec.mode === "cohort"
      ? `p.purchased_at >= u.first_seen AND p.purchased_at < u.first_seen + INTERVAL '${spec.windowDays}' DAY`
      : ts("p.purchased_at");
  const vTime =
    spec.mode === "cohort"
      ? `v.started_at >= u.first_seen AND v.started_at < u.first_seen + INTERVAL '${spec.windowDays}' DAY`
      : ts("v.started_at");
  const perUser = `per_user AS (SELECT u.user_id,u.first_seen,${selectDims("u")},COUNT(p.purchase_id) AS n_purchases,COALESCE(SUM(p.amount),0) AS revenue_amount,COALESCE(SUM(CASE WHEN p.purchase_index=1 THEN p.amount ELSE 0 END),0) AS first_amount,COALESCE(SUM(CASE WHEN p.purchase_index>1 THEN p.amount ELSE 0 END),0) AS repeat_amount,MIN(CASE WHEN p.purchase_index=1 THEN (unix_timestamp(p.purchased_at)-unix_timestamp(u.first_seen))/3600.0 ELSE NULL END) AS first_hours FROM population u LEFT JOIN ${prefix}.purchase_facts p ON p.user_id=u.user_id AND ${pTime} GROUP BY u.user_id,u.first_seen${dims.length ? "," + dims.map((d) => "u." + d).join(",") : ""})`;
  const ua = `user_agg AS (SELECT ${group},COUNT(*) AS n_users,SUM(CASE WHEN ${ts("first_seen")} THEN 1 ELSE 0 END) AS n_new,SUM(CASE WHEN n_purchases>0 THEN 1 ELSE 0 END) AS n_payers,SUM(CASE WHEN n_purchases>1 THEN 1 ELSE 0 END) AS n_repeat_payers,SUM(n_purchases) AS n_purchases,SUM(revenue_amount) AS revenue_amount,SUM(first_amount) AS first_amount,SUM(repeat_amount) AS repeat_amount,AVG(first_hours) AS first_hours FROM per_user GROUP BY ${group})`;
  const sa = `session_agg AS (SELECT ${selectDims("u")},COUNT(*) AS n_sessions FROM population u JOIN ${prefix}.visits v ON u.user_id=v.user_id AND ${vTime} ${dims.length ? "GROUP BY " + dims.map((d) => "u." + d).join(", ") : ""})`;
  const costFilters = [
    `c.cost_date >= ${dateOnly(period.start)}`,
    `c.cost_date < ${dateOnly(end)}`,
  ];
  if (spec.filters.channels.length)
    costFilters.push(
      `c.channel IN (${spec.filters.channels.map(quote).join(",")})`,
    );
  const ca = dims.some((d) => d !== "channel")
    ? `cost_agg AS (SELECT ${dims.map((d) => `CAST(NULL AS VARCHAR(100)) AS ${d},`).join("")} '__all' AS segment,CAST(NULL AS BIGINT) AS spend_amount WHERE 1=0)`
    : `cost_agg AS (SELECT ${dims.includes("channel") ? "c.channel," : ""}'__all' AS segment,SUM(c.amount) AS spend_amount FROM ${prefix}.costs c WHERE ${costFilters.join(" AND ")} ${dims.includes("channel") ? "GROUP BY c.channel" : ""})`;
  const ctes = [
    ...(spec.mode === "calendar" ? [activity] : []),
    pop,
    perUser,
    ua,
    sa,
    ca,
    `keys AS (SELECT ${group} FROM user_agg UNION SELECT ${group} FROM session_agg UNION SELECT ${group} FROM cost_agg)`,
  ];
  const sql = `WITH ${ctes.join(",\n")} SELECT ${selectKeys("k")},COALESCE(u.n_users,0) AS n_users,COALESCE(u.n_new,0) AS n_new,COALESCE(u.n_payers,0) AS n_payers,COALESCE(u.n_repeat_payers,0) AS n_repeat_payers,COALESCE(u.n_purchases,0) AS n_purchases,COALESCE(u.revenue_amount,0) AS revenue_amount,COALESCE(u.first_amount,0) AS first_amount,COALESCE(u.repeat_amount,0) AS repeat_amount,u.first_hours,COALESCE(s.n_sessions,0) AS n_sessions,c.spend_amount FROM keys k LEFT JOIN user_agg u ON ${joinKeys("k", "u")} LEFT JOIN session_agg s ON ${joinKeys("k", "s")} LEFT JOIN cost_agg c ON ${joinKeys("k", "c")} ORDER BY ${selectKeys("k")} LIMIT 201`;
  const excludedSql =
    spec.mode === "cohort" && end < period.end
      ? `SELECT COUNT(*) AS n FROM ${prefix}.profiles u WHERE ${fields} AND u.first_seen >= ${stamp(end)} AND u.first_seen >= ${stamp(period.start)} AND u.first_seen < ${stamp(period.end)}`
      : undefined;
  return { sql, excludedSql, end };
}
