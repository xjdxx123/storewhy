import type { AnalysisSpec } from "@storewhy/contracts";
import { filters, stamp, dateOnly } from "./compiler.ts";
// Aggregate each event family separately before joining; visits never multiply orders or costs.
export function compileTrend(
  spec: AnalysisSpec,
  period: AnalysisSpec["periods"][number],
  prefix: string,
): string {
  const grain = spec.timeGrain!;
  const bucket = (column: string) =>
    `CAST(CAST(date_trunc('${grain}',${column}) AS DATE) AS VARCHAR(10))`;
  const inRange = (column: string) =>
    `${column} >= ${stamp(period.start)} AND ${column} < ${stamp(period.end)}`;
  const dims = spec.groupBy;
  const dimSelect = (alias: string) =>
    dims.map((d) => `,${alias}.${d}`).join("");
  const keyNames = ["bucket", ...dims];
  const keys = keyNames.join(",");
  const join = (a: string, b: string) =>
    keyNames.map((d) => `${a}.${d}=${b}.${d}`).join(" AND ");
  const activity = `activity AS (SELECT ${bucket("started_at")} AS bucket,user_id FROM ${prefix}.visits WHERE ${inRange("started_at")} UNION SELECT ${bucket("purchased_at")} AS bucket,user_id FROM ${prefix}.purchases WHERE ${inRange("purchased_at")})`;
  const purchases = `purchase_user AS (SELECT ${bucket("p.purchased_at")} AS bucket,p.user_id,COUNT(*) AS n_purchases,SUM(p.amount) AS revenue_amount,SUM(CASE WHEN p.purchase_index=1 THEN p.amount ELSE 0 END) AS first_amount,SUM(CASE WHEN p.purchase_index>1 THEN p.amount ELSE 0 END) AS repeat_amount,MIN(CASE WHEN p.purchase_index=1 THEN (unix_timestamp(p.purchased_at)-unix_timestamp(u.first_seen))/3600.0 ELSE NULL END) AS first_hours FROM ${prefix}.purchase_facts p JOIN ${prefix}.profiles u ON p.user_id=u.user_id WHERE ${inRange("p.purchased_at")} AND ${filters(spec)} GROUP BY ${bucket("p.purchased_at")},p.user_id)`;
  const userAgg = `user_agg AS (SELECT a.bucket${dimSelect("u")},COUNT(*) AS n_users,SUM(CASE WHEN ${inRange("u.first_seen")} AND ${bucket("u.first_seen")}=a.bucket THEN 1 ELSE 0 END) AS n_new,SUM(CASE WHEN p.n_purchases>0 THEN 1 ELSE 0 END) AS n_payers,SUM(CASE WHEN p.n_purchases>1 THEN 1 ELSE 0 END) AS n_repeat_payers,COALESCE(SUM(p.n_purchases),0) AS n_purchases,COALESCE(SUM(p.revenue_amount),0) AS revenue_amount,COALESCE(SUM(p.first_amount),0) AS first_amount,COALESCE(SUM(p.repeat_amount),0) AS repeat_amount,AVG(p.first_hours) AS first_hours FROM activity a JOIN ${prefix}.profiles u ON a.user_id=u.user_id LEFT JOIN purchase_user p ON a.user_id=p.user_id AND a.bucket=p.bucket WHERE ${filters(spec)} GROUP BY a.bucket${dimSelect("u")})`;
  const sessionAgg = `session_agg AS (SELECT ${bucket("v.started_at")} AS bucket${dimSelect("u")},COUNT(*) AS n_sessions FROM ${prefix}.visits v JOIN ${prefix}.profiles u ON v.user_id=u.user_id WHERE ${inRange("v.started_at")} AND ${filters(spec)} GROUP BY ${bucket("v.started_at")}${dimSelect("u")})`;
  const costWhere = [
    `c.cost_date >= ${dateOnly(period.start)}`,
    `c.cost_date < ${dateOnly(period.end)}`,
  ];
  if (spec.filters.channels.length)
    costWhere.push(
      `c.channel IN (${spec.filters.channels.map((v) => "'" + v.replaceAll("'", "''") + "'").join(",")})`,
    );
  const costAgg = dims.some((d) => d !== "channel")
    ? `cost_agg AS (SELECT CAST(NULL AS VARCHAR(10)) AS bucket${dims.map((d) => `,CAST(NULL AS VARCHAR(100)) AS ${d}`).join("")},CAST(NULL AS BIGINT) AS spend_amount WHERE 1=0)`
    : `cost_agg AS (SELECT ${bucket("c.cost_date")} AS bucket${dims.includes("channel") ? ",c.channel" : ""},SUM(c.amount) AS spend_amount FROM ${prefix}.costs c WHERE ${costWhere.join(" AND ")} GROUP BY ${bucket("c.cost_date")}${dims.includes("channel") ? ",c.channel" : ""})`;
  return `WITH ${[activity, purchases, userAgg, sessionAgg, costAgg, `keys AS (SELECT ${keys} FROM user_agg UNION SELECT ${keys} FROM session_agg UNION SELECT ${keys} FROM cost_agg)`].join(",\n")} SELECT ${keyNames.map((d) => "k." + d).join(",")},COALESCE(u.n_users,0) AS n_users,COALESCE(u.n_new,0) AS n_new,COALESCE(u.n_payers,0) AS n_payers,COALESCE(u.n_repeat_payers,0) AS n_repeat_payers,COALESCE(u.n_purchases,0) AS n_purchases,COALESCE(u.revenue_amount,0) AS revenue_amount,COALESCE(u.first_amount,0) AS first_amount,COALESCE(u.repeat_amount,0) AS repeat_amount,u.first_hours,COALESCE(s.n_sessions,0) AS n_sessions,c.spend_amount FROM keys k LEFT JOIN user_agg u ON ${join("k", "u")} LEFT JOIN session_agg s ON ${join("k", "s")} LEFT JOIN cost_agg c ON ${join("k", "c")} ORDER BY ${keyNames.map((d) => "k." + d).join(",")} LIMIT 201`;
}
