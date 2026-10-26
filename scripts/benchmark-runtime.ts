import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "../apps/server/src/app.ts";
import {
  Nightshift,
  type ModelGateway,
} from "../apps/server/src/integrations/nightshift.ts";
import {
  ZetarisBackend,
  type SqlBackend,
} from "../apps/server/src/integrations/zetaris.ts";
import { StoreWhyClient } from "@storewhy/contracts/client";
import { settings } from "../apps/server/src/config.ts";
const output =
  process.argv.find((a) => a.startsWith("--output="))?.slice(9) ??
  "evidence/runtime-benchmark.json";
const count = Number(
  process.argv.find((a) => a.startsWith("--runs="))?.slice(7) ?? 5,
);
const label =
  process.argv.find((a) => a.startsWith("--label="))?.slice(8) ?? "candidate";
const mode = "live";
assert.ok(Number.isInteger(count) && count >= 1 && count <= 10);
const question =
  "为什么2019年7月比6月费用增加，新用户首访后14天收入却没有同步增长？";
const transport = new Nightshift(),
  sql = new ZetarisBackend();
let modelStages: unknown[] = [],
  sqlStages: unknown[] = [];
const gateway: ModelGateway = {
  async structured(role, schema, messages, traces, signal) {
    const start = performance.now();
    let outcome = "ok";
    try {
      return await transport.structured(role, schema, messages, traces, signal);
    } catch (e) {
      outcome = "error";
      throw e;
    } finally {
      modelStages.push({
        role,
        durationMs: Math.round(performance.now() - start),
        inputChars: messages.reduce((s, m) => s + m.content.length, 0),
        outcome,
      });
    }
  },
};
const backend: SqlBackend = {
  kind: "zetaris",
  async execute(query, signal) {
    const start = performance.now();
    let outcome = "ok";
    try {
      return await sql.execute(query, signal);
    } catch (e) {
      outcome = "error";
      throw e;
    } finally {
      sqlStages.push({
        durationMs: Math.round(performance.now() - start),
        outcome,
      });
    }
  },
};
const dir = mkdtempSync(path.join(tmpdir(), "storewhy-benchmark-"));
const server = await buildApp({ backend, gateway, stateDir: dir });
await server.app.listen({ port: 0, host: "127.0.0.1" });
const address = server.app.server.address();
assert.ok(address && typeof address !== "string");
const root = `http://127.0.0.1:${address.port}`,
  api = new StoreWhyClient(root);
const records: any[] = [];
async function save() {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(
    output,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        label,
        mode,
        question,
        model: settings.model,
        datasetVersion: server.analytics.datasetVersion,
        stateDir: dir,
        total: records.length,
        records,
      },
      null,
      2,
    ) + "\n",
  );
}
try {
  for (let i = 0; i < count; i++) {
    const c = await api.createConversation();
    modelStages = [];
    sqlStages = [];
    const start = performance.now();
    const queued = await api.send(c.id, question);
    const response = await fetch(
      root + "/api/v1/runs/" + queued.id + "/events",
    );
    assert.ok(response.ok && response.body);
    let firstEventMs: number | undefined,
      sse = "";
    const reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const text = new TextDecoder().decode(chunk.value);
      sse += text;
      if (firstEventMs === undefined && sse.includes("event:"))
        firstEventMs = Math.round(performance.now() - start);
    }
    assert.ok(sse.includes("event: done"));
    const run = await api.run(queued.id);
    const evidence = await Promise.all(
      run.evidenceIds.map((id) => api.evidence(id)),
    );
    let boundFacts = 0;
    for (const f of run.answer?.facts ?? []) {
      const e = evidence.find((e) => e.id === f.evidenceId);
      assert.equal(e?.backend, "zetaris");
      assert.equal(e.rows[f.rowIndex]?.values[f.metric], f.value);
      boundFacts++;
    }
    const record = {
      index: i + 1,
      runId: run.id,
      initialSpec: c.context.spec,
      status: run.status,
      message: run.message,
      durationMs: Math.round(performance.now() - start),
      firstEventMs,
      modelStages: [...modelStages],
      sqlStages: [...sqlStages],
      modelCallCount: run.modelTraces.length,
      repairCount: run.modelTraces.filter((t) => t.role.includes(":repair"))
        .length,
      queryCount: sqlStages.length,
      models: run.modelTraces,
      context: run.context,
      summary: run.answer?.summary,
      evidence: evidence.map(({ sql: _sql, ...e }) => e),
      boundFacts,
      events: run.events.map(({ data: _data, ...e }) => e),
      reviews: run.events
        .filter((e) => e.type === "review_completed")
        .map((e) => e.data),
    };
    records.push(record);
    await save();
    console.log(
      JSON.stringify({
        index: record.index,
        status: record.status,
        ms: record.durationMs,
        firstEventMs,
        modelCalls: record.modelCallCount,
        queries: record.queryCount,
        repairs: record.repairCount,
        summary: record.summary,
      }),
    );
  }
} finally {
  await save();
  await server.app.close();
}
if (records.some((r) => !["completed", "limited"].includes(r.status)))
  process.exitCode = 1;
