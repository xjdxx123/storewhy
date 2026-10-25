import fs from "node:fs/promises";
import {
  explanationSchema,
  type Evidence,
  type Fact,
} from "@storewhy/contracts";
// Deterministic audit of saved live results; never asks another model to grade itself.
const input = process.argv[2] ?? "evidence/why-reliability-final.json";
const report = JSON.parse(await fs.readFile(input, "utf8"));
const records = report.records.map((r: any) => {
  const errors: string[] = [...r.errors, ...r.qualityGaps];
  const a = r.answer;
  if (a) {
    if (r.id.startsWith("w1") || r.id.startsWith("f1"))
      if (!a.summary.includes("收入与记录费用比"))
        errors.push("ratio question not directly answered");
    if (
      ["w2-revenue-factors", "w5-maturity", "w6-device", "w7-region"].includes(
        r.id,
      ) &&
      !a.summary.includes("收入")
    )
      errors.push("income question not directly answered");
    if (r.id === "w3-purchase-composition" || r.id.startsWith("f2")) {
      if (
        !a.summary.includes("首次购买收入") ||
        !a.summary.includes("后续购买收入")
      )
        errors.push("purchase composition not directly answered");
      if (r.context.spec.timeGrain)
        errors.push("comparison incorrectly became a trend");
    }
    for (const check of a.explanations ?? []) {
      if (!explanationSchema.safeParse(check).success) {
        errors.push("invalid explanation schema");
        continue;
      }
      const sources: Evidence[] = check.evidenceIds.map((id: string) =>
        r.evidence.find((e: Evidence) => e.id === id),
      );
      if (sources.some((e) => !e || e.truncated)) {
        errors.push("missing or truncated explanation source");
        continue;
      }
      const facts: Fact[] = check.factIds.map((id: string) =>
        a.facts.find((f: Fact) => f.id === id),
      );
      if (facts.some((f) => !f || !check.evidenceIds.includes(f.evidenceId))) {
        errors.push("explanation fact not bound to claimed evidence");
        continue;
      }
      for (const ref of check.coverageRefs)
        if (
          !sources.some(
            (e) =>
              e.id === ref.evidenceId &&
              e.coverage.some((c) => c.period === ref.period),
          )
        )
          errors.push("invalid coverage reference");
      if (!["supported", "contradicted"].includes(check.status)) continue;
      if (!(facts.length || check.coverageRefs.length))
        errors.push("verified check lacks executed facts or coverage");
      const pair = (metric: string) => {
        const refs = facts.filter((f) => f.metric === metric);
        const e = sources.find((e) => e.id === refs[0]?.evidenceId);
        if (!e || e.spec.periods.length !== 2) return;
        const values = e.spec.periods.map((p) => {
          const f = refs.find((f) => e.rows[f.rowIndex].period === p.label);
          return f?.value;
        });
        if (values.some((v) => v === undefined || v === null)) return;
        return values as [number, number];
      };
      let supported: boolean | undefined;
      const metric =
        check.kind === "traffic"
          ? facts.some((f) => f.metric === "users")
            ? "users"
            : "new_users"
          : check.kind === "conversion"
            ? "payer_rate"
            : "revenue_per_payer";
      if (["traffic", "conversion", "purchase_value"].includes(check.kind)) {
        const p = pair(metric),
          rev = pair("revenue");
        if (!p || !rev) errors.push("direction claim lacks paired values");
        else
          supported =
            rev[1] !== rev[0] &&
            Math.sign(rev[1] - rev[0]) === Math.sign(p[1] - p[0]);
      }
      if (check.kind === "spend_efficiency") {
        const spend = pair("spend"),
          rev = pair("revenue");
        if (!spend || !rev || !spend[0] || !rev[0])
          errors.push("efficiency claim lacks denominators");
        else
          supported =
            spend[1] > spend[0] &&
            (rev[1] - rev[0]) / rev[0] < (spend[1] - spend[0]) / spend[0];
      }
      if (check.kind === "repeat") {
        const first = pair("first_purchase_revenue"),
          repeat = pair("repeat_purchase_revenue"),
          rev = pair("revenue");
        if (!first || !repeat || !rev)
          errors.push("composition lacks paired amounts");
        else
          supported =
            Math.abs(
              first[1] - first[0] + (repeat[1] - repeat[0]) - (rev[1] - rev[0]),
            ) <= 0.020001;
      }
      if (check.kind === "maturity")
        supported = sources.every((e) =>
          e.coverage.every((c) => c.excludedUsers === 0),
        );
      if (check.kind === "channel_mix") {
        const e = sources[0];
        const changes = e.comparisons.filter((c) => c.metric === "revenue");
        if (changes.length < 2 || changes.some((c) => c.delta === null))
          errors.push("channel claim lacks complete comparisons");
        else supported = new Set(changes.map((c) => c.delta)).size > 1;
      }
      if (
        supported !== undefined &&
        (supported ? "supported" : "contradicted") !== check.status
      )
        errors.push(
          "explanation status contradicts executed numbers: " + check.kind,
        );
    }
    for (const action of a.followups ?? []) {
      for (const k of ["channels", "devices", "regions"]) {
        const constrained = r.context.spec.filters[k];
        if (
          constrained.length &&
          (!action.patch.filters[k].length ||
            action.patch.filters[k].some(
              (v: string) => !constrained.includes(v),
            ))
        )
          errors.push("recommendation expands explicit filter");
      }
    }
  }
  return {
    id: r.id,
    status: r.status,
    pass: !errors.length,
    errors: [...new Set(errors)],
  };
});
const result = {
  at: new Date().toISOString(),
  source: input.split("/").at(-1),
  method:
    "Deterministic checks of direct answers, explanation status versus paired facts/coverage, and recommendation constraints. Independent CSV verification is recorded separately; human review is still required.",
  total: records.length,
  passed: records.filter((r: any) => r.pass).length,
  records,
};
await fs.writeFile(
  input.replace(/\.json$/, "-audit.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
if (result.passed !== result.total) process.exitCode = 1;
