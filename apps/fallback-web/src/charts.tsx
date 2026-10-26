import type { Chart, ChartPoint, ChartUnit } from "@storewhy/contracts";
export type EvidenceRequest = {
  id: string;
  rowIndex?: number;
  metric?: string;
};
export const unitLabels: Record<ChartUnit, string> = {
  sample_amount: "样例金额",
  count: "人数 / 次数",
  proportion: "%",
  multiple: "倍",
  hours: "小时",
  sample_amount_per_user: "样例金额 / 用户",
  sample_amount_per_payer: "样例金额 / 购买用户",
};
export function formatValue(value: number | null, unit?: ChartUnit) {
  if (value === null) return "不可计算 / 缺失";
  return (
    new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(
      unit === "proportion" ? value * 100 : value,
    ) + (unit === "proportion" ? "%" : "")
  );
}
function consecutiveBucket(
  previous: string | undefined,
  current: string | undefined,
  grain: Chart["source"]["spec"]["timeGrain"],
) {
  if (!previous || !current || !grain) return false;
  const next = new Date(`${previous}T00:00:00Z`);
  if (grain === "month") next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCDate(next.getUTCDate() + (grain === "week" ? 7 : 1));
  return next.toISOString().slice(0, 10) === current;
}
const colors = [
  "#496a5b",
  "#b88c55",
  "#5c7897",
  "#ae7171",
  "#8a7b9e",
  "#687d80",
];
export function EvidenceChart({
  chart,
  open,
}: {
  chart: Chart;
  open: (r: EvidenceRequest) => void;
}) {
  const all = chart.series.flatMap((s) => s.points);
  const keys = [...new Set(all.map((p) => p.key))];
  const buckets = new Map(all.map((p) => [p.key, p.bucket]));
  if (chart.type === "line")
    keys.sort((a, b) =>
      (buckets.get(a) ?? "").localeCompare(buckets.get(b) ?? ""),
    );
  const labels = new Map(all.map((p) => [p.key, p.label]));
  const series = chart.series.map(
    (s) => new Map(s.points.map((p) => [p.key, p])),
  );
  const values = all.flatMap((p) => (p.value === null ? [] : [p.value]));
  const sums = keys.flatMap((key) => [
    series.reduce((sum, s) => sum + Math.max(0, s.get(key)?.value ?? 0), 0),
    series.reduce((sum, s) => sum + Math.min(0, s.get(key)?.value ?? 0), 0),
  ]);
  const low = Math.min(0, ...(chart.type === "stacked_bar" ? sums : values));
  const high =
    Math.max(0, ...(chart.type === "stacked_bar" ? sums : values)) || 1;
  const width = Math.max(640, keys.length * (chart.type === "line" ? 36 : 90)),
    height = 290;
  const left = 76,
    right = width - 20,
    top = 24,
    bottom = 210;
  const y = (v: number) => bottom - ((v - low) / (high - low)) * (bottom - top);
  const dates = keys.map((key) =>
    Date.parse(all.find((p) => p.key === key)?.bucket ?? ""),
  );
  const time =
    chart.type === "line" &&
    dates.every(Number.isFinite) &&
    new Set(dates).size > 1;
  const dateLow = Math.min(...dates),
    dateHigh = Math.max(...dates);
  const x = (i: number) =>
    time
      ? left +
        16 +
        ((dates[i] - dateLow) / (dateHigh - dateLow)) * (right - left - 32)
      : left + ((i + 0.5) / keys.length) * (right - left);
  const data = (p: ChartPoint) => ({
    "data-evidence-id": p.source.evidenceId,
    "data-row-index": p.source.rowIndex,
    "data-metric": p.source.metric,
    "data-value": p.value ?? undefined,
  });
  function pointTitle(p: ChartPoint, seriesLabel: string) {
    return `${p.label} · ${seriesLabel}：${formatValue(p.value, chart.yAxis.unit)}`;
  }
  const positives = new Map<string, number>(),
    negatives = new Map<string, number>();
  return (
    <section className="chart-card" data-chart-id={chart.id}>
      <div className="section-heading">
        <h3>{chart.title}</h3>
        <span className="meta">{unitLabels[chart.yAxis.unit]}</span>
      </div>
      <div className="legend">
        {chart.series.map((s, i) => (
          <span key={s.id}>
            <i style={{ background: colors[i % colors.length] }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="chart-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth: width }}
          role="img"
          aria-label={`${chart.title}，完整数值和来源可在下方展开`}
        >
          {[0, 1, 2, 3].map((i) => {
            const v = low + ((high - low) * i) / 3;
            return (
              <g key={i}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="#eaeaea"
                />
                <text x={left - 10} y={y(v) + 4} textAnchor="end">
                  {formatValue(v, chart.yAxis.unit)}
                </text>
              </g>
            );
          })}
          <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="#b8bcb6" />
          {chart.series.map((s, si) => {
            let pen = false;
            let previousBucket: string | undefined;
            const path = keys
              .map((key, i) => {
                const p = series[si].get(key);
                if (!p || p.value === null) {
                  pen = false;
                  return "";
                }
                const continuous =
                  pen &&
                  consecutiveBucket(
                    previousBucket,
                    p.bucket,
                    chart.source.spec.timeGrain,
                  );
                const command = `${continuous ? "L" : "M"}${x(i)},${y(p.value)}`;
                previousBucket = p.bucket;
                pen = true;
                return command;
              })
              .join(" ");
            return (
              <g key={s.id} fill={colors[si % colors.length]}>
                {chart.type === "line" && (
                  <path
                    d={path}
                    fill="none"
                    stroke={colors[si % colors.length]}
                    strokeWidth="2"
                  />
                )}
                {keys.map((key, i) => {
                  const p = series[si].get(key);
                  if (!p || p.value === null) return null;
                  if (chart.type === "line")
                    return (
                      <circle
                        key={key}
                        cx={x(i)}
                        cy={y(p.value)}
                        r="3.5"
                        {...data(p)}
                      >
                        <title>{pointTitle(p, s.label)}</title>
                      </circle>
                    );
                  const slot = (right - left) / keys.length,
                    groupWidth = slot * 0.65;
                  if (chart.type === "stacked_bar") {
                    const stack = p.value >= 0 ? positives : negatives,
                      start = stack.get(key) ?? 0,
                      end = start + p.value;
                    stack.set(key, end);
                    return (
                      <rect
                        key={key}
                        x={x(i) - groupWidth / 2}
                        y={Math.min(y(start), y(end))}
                        width={groupWidth}
                        height={Math.abs(y(end) - y(start))}
                        {...data(p)}
                      >
                        <title>{pointTitle(p, s.label)}</title>
                      </rect>
                    );
                  }
                  const barWidth = groupWidth / chart.series.length;
                  return (
                    <rect
                      key={key}
                      x={x(i) - groupWidth / 2 + si * barWidth}
                      y={Math.min(y(0), y(p.value))}
                      width={Math.max(1, barWidth - 2)}
                      height={Math.abs(y(p.value) - y(0))}
                      {...data(p)}
                    >
                      <title>{pointTitle(p, s.label)}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
          {keys.map((key, i) =>
            chart.type === "line" &&
            i % Math.max(1, Math.ceil(keys.length / 8)) !== 0 ? null : (
              <text key={key} x={x(i)} y={bottom + 22} textAnchor="middle">
                <title>{labels.get(key)}</title>
                {(labels.get(key) ?? key).length > 16
                  ? (labels.get(key) ?? key).slice(0, 15) + "…"
                  : labels.get(key)}
              </text>
            ),
          )}
        </svg>
      </div>
      {chart.notes.length > 0 && (
        <p className="caption">{chart.notes.join(" ")}</p>
      )}
      <details>
        <summary>查看全部数据与来源</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>系列</th>
                <th>范围</th>
                <th>数值</th>
                <th>依据</th>
              </tr>
            </thead>
            <tbody>
              {chart.series.flatMap((s) =>
                s.points.map((p) => (
                  <tr key={`${s.id}-${p.key}`}>
                    <td>{s.label}</td>
                    <td>{p.label}</td>
                    <td>{formatValue(p.value, chart.yAxis.unit)}</td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() =>
                          open({
                            id: p.source.evidenceId,
                            rowIndex: p.source.rowIndex,
                            metric: p.source.metric,
                          })
                        }
                      >
                        查看来源
                      </button>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
