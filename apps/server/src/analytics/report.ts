import { LABELS } from "./catalog.ts";
import type { Evidence, Fact, Finding } from "@storewhy/contracts";
// Query-only requests do not need a model-generated explanation or model arithmetic.
export function queryFindings(evidence: Evidence[], facts: Fact[]): Finding[] {
  const result: Finding[] = [];
  for (const e of evidence) {
    if (e.spec.groupBy.length === 0 || e.spec.timeGrain) continue;
    for (const metric of e.spec.metrics.slice(0, 2)) {
      const changes = e.comparisons
        .filter((c) => c.metric === metric && c.delta !== null)
        .sort((a, b) => b.delta! - a.delta!);
      if (changes.length) {
        for (const c of [
          changes[0],
          ...(changes.length > 1 ? [changes.at(-1)!] : []),
        ]) {
          const bound = facts.filter(
            (f) =>
              f.evidenceId === e.id &&
              f.metric === metric &&
              JSON.stringify(e.rows[f.rowIndex].dimensions) ===
                JSON.stringify(c.dimensions),
          );
          result.push({
            text: `按所列比较时期，${Object.values(c.dimensions).join(" / ")} 的 ${LABELS[metric]} 变化为 ${c.delta}。`,
            factIds: bound.map((f) => f.id),
          });
        }
      } else
        for (const period of e.spec.periods) {
          const rows = e.rows
            .map((row, index) => ({ row, index }))
            .filter(
              ({ row }) =>
                row.period === period.label &&
                row.values[metric] !== null &&
                row.values[metric] !== undefined,
            )
            .sort((a, b) => b.row.values[metric]! - a.row.values[metric]!);
          if (rows.length) {
            const top = rows[0];
            const fact = facts.find(
              (f) =>
                f.evidenceId === e.id &&
                f.rowIndex === top.index &&
                f.metric === metric,
            )!;
            result.push({
              text: `${period.label} 中，${Object.values(top.row.dimensions).join(" / ")} 的 ${LABELS[metric]} 最高，值为 ${top.row.values[metric]}。`,
              factIds: [fact.id],
            });
          }
        }
    }
  }
  return result.slice(0, 6);
}
