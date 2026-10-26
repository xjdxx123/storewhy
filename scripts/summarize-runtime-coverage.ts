import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { isDirectDataRequest } from "../apps/server/src/context/constraints.ts";
const read = async (name: string) =>
  JSON.parse(await fs.readFile("evidence/" + name, "utf8"));
const original = await read("runtime-legacy-before-query-routing.json");
const queries = await read("runtime-query-routing-regression.json");
const followups = await read("runtime-followup-regression.json");
const key = (r: any) => r.group + ":" + r.name;
const eligible = original.records.filter(
  (r: any) =>
    !r.group.startsWith("followup-") && isDirectDataRequest(r.question),
);
assert.deepEqual(
  queries.records.map((r: any) => r.name).sort(),
  eligible.map((r: any) => r.name).sort(),
);
assert.deepEqual(
  followups.records.map(key).sort(),
  original.records
    .filter((r: any) => r.group.startsWith("followup-"))
    .map(key)
    .sort(),
);
const records = original.records.map((r: any) => {
  const changedContext = r.group.startsWith("followup-");
  const changedQuery = !changedContext && isDirectDataRequest(r.question);
  const replacement = changedContext
    ? followups.records.find((f: any) => key(f) === key(r))
    : changedQuery
      ? queries.records.find((f: any) => f.name === r.name)
      : undefined;
  if (changedContext || changedQuery) assert.ok(replacement);
  if (replacement) assert.equal(replacement.question, r.question);
  const current = replacement ?? r;
  return {
    group: r.group,
    name: r.name,
    pass: current.pass,
    status: current.status,
    errors: current.errors,
    source: replacement
      ? changedContext
        ? "runtime-followup-regression.json"
        : "runtime-query-routing-regression.json"
      : "runtime-legacy-before-query-routing.json",
    runId: current.runId,
  };
});
const report = {
  at: new Date().toISOString(),
  kind: "composed_coverage_not_a_single_fresh_44_case_run",
  method:
    "Retain the 44-case first pass, rerun all 16 standalone inputs eligible for the final value-query guard and all 12 context sequences. Unchanged input paths retain their first-pass evidence. Failures and retries are never relabeled as first-pass successes.",
  firstPass: {
    total: original.total,
    passed: original.passed,
    failures: original.records
      .filter((r: any) => !r.pass)
      .map((r: any) => ({
        group: r.group,
        name: r.name,
        status: r.status,
        message: r.message,
      })),
  },
  targetedRerun: {
    total: queries.total + followups.total,
    passed: queries.passed + followups.passed,
  },
  total: records.length,
  passed: records.filter((r: any) => r.pass).length,
  pass: records.length === 44 && records.every((r: any) => r.pass),
  records,
};
await fs.writeFile(
  "evidence/runtime-legacy-coverage.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    firstPass: report.firstPass,
    targetedRerun: report.targetedRerun,
    composedCoverage: { total: report.total, passed: report.passed },
    pass: report.pass,
  }),
);
if (!report.pass) process.exitCode = 1;
