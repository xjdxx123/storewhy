import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FixtureBackend } from "../apps/server/src/integrations/fixture.ts";
import { buildApp } from "../apps/server/src/app.ts";
import { ScriptedGateway, wait } from "./helpers.ts";
let server: Awaited<ReturnType<typeof buildApp>>,
  b: FixtureBackend,
  dir: string;
beforeAll(async () => {
  b = new FixtureBackend();
  await b.initialize();
  dir = mkdtempSync(path.join(tmpdir(), "storewhy-api-"));
  server = await buildApp({
    backend: b,
    gateway: new ScriptedGateway(),
    stateDir: dir,
    datasetVersion: "fixture-test",
  });
});
afterAll(async () => {
  await server.app.close();
  await b.close();
  rmSync(dir, { recursive: true, force: true });
});
it("exposes catalog, async runs, result evidence and resumable SSE", async () => {
  const cat = await server.app.inject("/api/v1/catalog");
  expect(cat.statusCode).toBe(200);
  expect(cat.json().dataset.kind).toBe("self_authored_fixture");
  const c = (
    await server.app.inject({ method: "POST", url: "/api/v1/conversations" })
  ).json();
  const queued = await server.app.inject({
    method: "POST",
    url: `/api/v1/conversations/${c.id}/messages`,
    payload: { message: "解释增长" },
  });
  expect(queued.statusCode).toBe(202);
  const r = await wait(server.engine, queued.json().id);
  expect(r.status).toBe("completed");
  const e = await server.app.inject("/api/v1/evidence/" + r.evidenceIds[0]);
  expect(e.json().backend).toBe("fixture");
  const stream = await server.app.inject(
    "/api/v1/runs/" + r.id + "/events?after=1",
  );
  expect(stream.headers["content-type"]).toContain("text/event-stream");
  expect(stream.body).toContain("event: done");
  expect(stream.body).not.toContain("id: 1\n");
});
it("validates input and blocks invalid path identifiers", async () => {
  expect(
    (
      await server.app.inject({
        method: "POST",
        url: "/api/v1/analytics/query",
        payload: { sql: "DROP TABLE" },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await server.app.inject("/api/v1/runs/not-a-real-run")).statusCode,
  ).toBe(404);
  expect((await server.app.inject("/api/v1/runs/bad!")).statusCode).toBe(400);
});
it("has a usable OpenAPI document", async () => {
  const r = await server.app.inject("/api/v1/openapi.json");
  expect(r.statusCode).toBe(200);
  expect(r.json().openapi).toBe("3.1.0");
  expect(r.json().components.schemas.AnalysisSpec).toBeTruthy();
});

it("closes an active SSE stream by cancelling the run before server shutdown", async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "storewhy-close-"));
  const local = await buildApp({
    backend: b,
    datasetVersion: "fixture-test",
    stateDir: temporary,
    gateway: {
      async structured(_role, _schema, _messages, _traces, signal) {
        await new Promise((_resolve, reject) => {
          if (signal?.aborted) reject(new Error("cancelled"));
          else
            signal?.addEventListener(
              "abort",
              () => reject(new Error("cancelled")),
              { once: true },
            );
        });
        throw new Error("unreachable");
      },
    },
  });
  try {
    const c = (
      await local.app.inject({ method: "POST", url: "/api/v1/conversations" })
    ).json();
    const queued = local.engine.createRun(c.id, { message: "调查" });
    const stream = local.app.inject("/api/v1/runs/" + queued.id + "/events");
    await new Promise((resolve) => setTimeout(resolve, 15));
    await local.app.close();
    const result = await stream;
    expect(result.body).toContain("event: cancelled");
    expect(result.body).toContain("event: done");
  } finally {
    await local.app.close();
    rmSync(temporary, { recursive: true, force: true });
  }
});
