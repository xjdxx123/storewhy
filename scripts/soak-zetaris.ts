import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Analytics, specKey } from "../apps/server/src/analytics/service.ts";
import { ZetarisBackend } from "../apps/server/src/integrations/zetaris.ts";
import type { Evidence } from "@storewhy/contracts";
const docker =
  process.env.STOREWHY_DOCKER ??
  "/Applications/Docker.app/Contents/Resources/bin/docker";
const output = "evidence/zetaris-memory-soak.json";
function runtimeEnv(key: string) {
  try {
    return execFileSync(docker, ["exec", "zetaris-driver-1", "printenv", key], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unset";
  }
}
const runtimeProfile = {
  mallocArenaMax: runtimeEnv("MALLOC_ARENA_MAX"),
  driverHeap: runtimeEnv("ZSPARK_DRIVER_MEM"),
};
const source = JSON.parse(
  await fs.readFile("evidence/runtime-why-regression.json", "utf8"),
);
const specs = new Map<string, Evidence>();
for (const r of source.records)
  for (const e of r.evidence) specs.set(specKey(e.spec), e);
const rounds = Number(
  process.argv.find((a) => a.startsWith("--rounds="))?.slice(9) ?? 2,
);
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 4);
function state() {
  return JSON.parse(
    execFileSync(
      docker,
      [
        "inspect",
        "zetaris-driver-1",
        "--format",
        '{"id":{{json .Id}},"startedAt":{{json .State.StartedAt}},"restartCount":{{.RestartCount}},"health":{{json .State.Health.Status}}}',
      ],
      { encoding: "utf8" },
    ),
  );
}
function memory() {
  const r = JSON.parse(
    execFileSync(
      docker,
      ["stats", "--no-stream", "--format", "{{json .}}", "zetaris-driver-1"],
      { encoding: "utf8" },
    ),
  );
  return {
    at: new Date().toISOString(),
    memory: r.MemUsage,
    percent: r.MemPerc,
  };
}
const digest = (e: Evidence) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        rows: e.rows,
        comparisons: e.comparisons,
        coverage: e.coverage,
      }),
    )
    .digest("hex");
for (let i = 0; state().health !== "healthy"; i++) {
  if (i >= 24) throw new Error("Driver did not become healthy");
  await new Promise((r) => setTimeout(r, 5000));
}
const initial = state(),
  backend = new ZetarisBackend(),
  analytics = new Analytics(backend, source.datasetVersion);
const records: any[] = [],
  samples: any[] = [memory()];
let failure: string | undefined;
try {
  const ready = await backend.execute("SELECT 1 AS n");
  assert.equal(Number(ready.rows[0]?.n), 1);
  for (let round = 1; round <= rounds; round++)
    for (const [key, expected] of specs) {
      const evidence = await analytics.query(expected.spec);
      assert.equal(
        digest(evidence),
        digest(expected),
        "Rows/comparisons/coverage changed under allocator profile",
      );
      records.push({
        round,
        key,
        sourceEvidenceId: expected.id,
        evidenceId: evidence.id,
        queryIds: evidence.queryIds,
        sqlCount: evidence.queryIds.length,
        durationMs: evidence.durationMs,
        dataDigest: digest(evidence),
        pass: true,
      });
      if (records.length % 5 === 0) {
        const current = state();
        assert.equal(current.id, initial.id);
        assert.equal(
          current.startedAt,
          initial.startedAt,
          "Driver restarted during soak",
        );
        samples.push(memory());
        if (Number.parseFloat(samples.at(-1).percent) > 75)
          throw new Error(
            "Driver working set exceeded the 75% local Docker budget; stopping soak before further load",
          );
        console.log(
          JSON.stringify({
            completedAnalyses: records.length,
            sqlCount: records.reduce((s, r) => s + r.sqlCount, 0),
            memory: samples.at(-1),
          }),
        );
      }
    }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}
const final = state();
samples.push(memory());
const report = {
  at: new Date().toISOString(),
  kind: "finite_live_sql_soak_allocator_profile_not_unlimited_stability_guarantee",
  profile: runtimeProfile,
  source: "runtime-why-regression.json (independently CSV-verified)",
  rounds,
  uniqueSpecs: specs.size,
  analyses: records.length,
  sqlCount: records.reduce((s, r) => s + r.sqlCount, 0),
  initial,
  final,
  samples,
  pass:
    !failure &&
    records.length === rounds * specs.size &&
    initial.id === final.id &&
    initial.startedAt === final.startedAt,
  ...(failure ? { failure } : {}),
  records,
};
await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    pass: report.pass,
    analyses: report.analyses,
    sqlCount: report.sqlCount,
    failure,
  }),
);
if (!report.pass) process.exitCode = 1;
