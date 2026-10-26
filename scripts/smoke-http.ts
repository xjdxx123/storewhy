import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { StoreWhyClient } from "@storewhy/contracts/client";
const url = process.env.STOREWHY_HTTP_URL ?? "http://127.0.0.1:3100";
const api = new StoreWhyClient(url);
const health = await (await fetch(url + "/healthz")).json();
assert.equal(health.dataMode, "zetaris");
const cors = await fetch(url + "/api/v1/catalog", {
  headers: { Origin: "http://localhost:5173" },
});
assert.equal(
  cors.headers.get("access-control-allow-origin"),
  "http://localhost:5173",
);
const doc = await (await fetch(url + "/api/v1/openapi.json")).json();
assert.equal(doc.openapi, "3.1.0");
const c = await api.createConversation();
const queued = await api.send(c.id, "查询2019年7月所有用户自然月收入", {
  patch: {
    mode: "calendar",
    timeGrain: null,
    audience: "all",
    periods: [{ label: "2019-07", start: "2019-07-01", end: "2019-08-01" }],
    metrics: ["revenue", "purchases", "users"],
    filters: { channels: [], devices: [], regions: [] },
    groupBy: [],
  },
});
const stream = await fetch(url + "/api/v1/runs/" + queued.id + "/events");
assert.equal(stream.status, 200);
assert.ok(stream.headers.get("content-type")?.includes("text/event-stream"));
const events = await stream.text();
assert.ok(events.includes("event: done"));
const run = await api.run(queued.id);
assert.equal(run.status, "completed");
assert.ok(run.answer?.facts.length);
const e = await api.evidence(run.evidenceIds[0]);
assert.equal(e.backend, "zetaris");
assert.ok(e.queryIds.length);
const report = {
  at: new Date().toISOString(),
  result: "PASS",
  health,
  openapiPathCount: Object.keys(doc.paths).length,
  cors: true,
  runId: run.id,
  evidenceId: e.id,
  rows: e.rows,
  sseEventTypes: [...events.matchAll(/^event: (.+)$/gm)].map((m) => m[1]),
  builtArtifact: true,
};
await fs.writeFile("evidence/http-smoke.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes("--agent")) {
  const conversation = await api.createConversation();
  const start = Date.now();
  const q = await api.send(
    conversation.id,
    "为什么2019年7月比6月费用增加，新用户首访后14天收入却没有同步增长？",
  );
  const events = await (
    await fetch(url + "/api/v1/runs/" + q.id + "/events")
  ).text();
  assert.ok(events.includes("event: done"));
  const r = await api.run(q.id);
  assert.ok(["completed", "limited"].includes(r.status), r.message);
  assert.ok(r.modelTraces.some((t) => t.role === "reviewer"));
  assert.ok(r.evidenceIds.length >= 1);
  const report = {
    at: new Date().toISOString(),
    result: "PASS",
    status: r.status,
    durationMs: Date.now() - start,
    question: r.question,
    context: r.context,
    answer: r.answer,
    modelTraces: r.modelTraces,
    evidence: await Promise.all(r.evidenceIds.map((id) => api.evidence(id))),
  };
  await fs.writeFile(
    "evidence/http-agent-smoke.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      agent: "PASS",
      status: r.status,
      durationMs: report.durationMs,
      evidenceCount: r.evidenceIds.length,
    }),
  );
}
