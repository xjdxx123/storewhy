import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runProgressSchema, type Run } from "@storewhy/contracts";
import { Analytics } from "../apps/server/src/analytics/service.ts";
import { DEFAULT_SPEC } from "@storewhy/contracts";
import { FixtureBackend } from "../apps/server/src/integrations/fixture.ts";
import { buildApp } from "../apps/server/src/app.ts";
import { Nightshift } from "../apps/server/src/integrations/nightshift.ts";
import { settings, AppError } from "../apps/server/src/config.ts";
import { draftSchema } from "../apps/server/src/agents/schemas.ts";
import { validateSelection } from "../apps/server/src/analytics/observations.ts";
import { ScriptedGateway, wait } from "./helpers.ts";
let backend: FixtureBackend;
const dirs: string[] = [];
beforeAll(async () => {
  backend = new FixtureBackend();
  await backend.initialize();
});
afterAll(async () => {
  await backend.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
function state() {
  const dir = mkdtempSync(path.join(tmpdir(), "storewhy-runtime-test-"));
  dirs.push(dir);
  return dir;
}
async function start(options: Partial<Parameters<typeof buildApp>[0]> = {}) {
  return buildApp({
    backend,
    gateway: new ScriptedGateway(),
    stateDir: state(),
    datasetVersion: "runtime-fixture",
    ...options,
  });
}
async function conversation(s: Awaited<ReturnType<typeof buildApp>>) {
  return (
    await s.app.inject({ method: "POST", url: "/api/v1/conversations" })
  ).json();
}
it("persists truthful stage progress, model/SQL counts and terminal timing", async () => {
  const s = await start();
  try {
    const c = await conversation(s);
    const r = await wait(
      s.engine,
      s.engine.createRun(c.id, { message: "为什么费用与收入变化" }).id,
    );
    expect(r.status).toBe("completed");
    expect(r.timing!.sqlCount).toBe(4);
    expect(r.timing!.modelCalls).toBe(r.modelTraces.length);
    expect(r.timing!.steps.filter((t) => t.phase === "query")).toHaveLength(2);
    expect(
      r.timing!.steps.every((t) => t.outcome === "ok" && t.durationMs >= 0),
    ).toBe(true);
    expect(r.progress?.phase).toBe("complete");
    const phases = r.events
      .filter((e) => e.type === "progress")
      .map((e) => runProgressSchema.parse(e.progress).phase);
    expect(phases).toEqual(
      expect.arrayContaining([
        "understanding",
        "querying",
        "explaining",
        "reviewing",
        "presenting",
      ]),
    );
    expect(r.events.at(-1)?.progress?.phase).toBe("complete");
    expect(r.events.at(-1)?.type).toBe("answer_ready");
    const stream = await s.app.inject(`/api/v1/runs/${r.id}/events`);
    expect(stream.body).toContain('"phase":"complete"');
    expect(stream.body).toContain("event: done");
  } finally {
    await s.app.close();
  }
});
it("uses the newer Last-Event-ID on an automatic reconnect with a stale query cursor", async () => {
  const s = await start();
  try {
    const c = await conversation(s);
    const r = await wait(
      s.engine,
      s.engine.createRun(c.id, { message: "为什么收入变化" }).id,
    );
    const stream = await s.app.inject({
      url: `/api/v1/runs/${r.id}/events?after=1`,
      headers: { "last-event-id": "4" },
    });
    expect(stream.statusCode).toBe(200);
    for (const seq of [1, 2, 3, 4])
      expect(stream.body).not.toContain(`id: ${seq}\n`);
    expect(stream.body).toContain("id: 5\n");
    const future = await s.app.inject(`/api/v1/runs/${r.id}/events?after=9999`);
    expect(future.statusCode).toBe(400);
    expect(future.json().error.code).toBe("CURSOR_AHEAD");
  } finally {
    await s.app.close();
  }
});
it("cancels in-flight SQL without appending evidence or a report", async () => {
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const s = await start({
    backend: {
      kind: "zetaris",
      async execute(_sql, signal) {
        entered();
        await new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
        throw new Error("unreachable");
      },
    },
  });
  try {
    const c = await conversation(s);
    const q = s.engine.createRun(c.id, {
      message: "查询收入",
      patch: { metrics: ["revenue"] },
      taskKind: "query",
    });
    await started;
    const cancelled = s.engine.cancel(q.id);
    expect(cancelled.cancellationRequested).toBe(true);
    const r = await wait(s.engine, q.id);
    expect(r.status).toBe("cancelled");
    expect(r.answer).toBeUndefined();
    expect(r.evidenceIds).toEqual([]);
    expect(r.error?.code).toBe("CANCELLED");
    expect(r.timing?.steps.at(-1)?.outcome).toBe("cancelled");
  } finally {
    await s.app.close();
  }
});
it("checks cancellation after an uncooperative gateway returns", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const execute = vi.fn();
  const s = await start({
    backend: { kind: "zetaris", execute },
    gateway: {
      async structured(_role, schema) {
        entered();
        await gate;
        return schema.parse({ kind: "query", patch: { metrics: ["revenue"] } });
      },
    },
  });
  try {
    const c = await conversation(s);
    const q = s.engine.createRun(c.id, { message: "查询收入" });
    await started;
    s.engine.cancel(q.id);
    release();
    const r = await wait(s.engine, q.id);
    expect(r.status).toBe("cancelled");
    expect(execute).not.toHaveBeenCalled();
  } finally {
    release();
    await s.app.close();
  }
});
it("reports the whole-run deadline as retryable and never returns a partial answer", async () => {
  const s = await start({
    runTimeoutMs: 25,
    gateway: {
      async structured(_r, _s, _m, _t, signal) {
        await new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
        throw new Error("unreachable");
      },
    },
  });
  try {
    const c = await conversation(s);
    const r = await wait(
      s.engine,
      s.engine.createRun(c.id, { message: "为什么收入变化" }).id,
    );
    expect(r.status).toBe("failed");
    expect(r.error).toEqual({ code: "RUN_TIMEOUT", retryable: true });
    expect(r.answer).toBeUndefined();
    expect(r.progress?.phase).toBe("failed");
  } finally {
    await s.app.close();
  }
});
it("gives a structured data outage rather than fixture fallback", async () => {
  const s = await start({
    backend: {
      kind: "zetaris",
      async execute() {
        throw new AppError("ZETARIS_OFFLINE", "test-only outage", 503);
      },
    },
  });
  try {
    const c = await conversation(s);
    const r = await wait(
      s.engine,
      s.engine.createRun(c.id, {
        message: "查询收入",
        patch: { metrics: ["revenue"] },
        taskKind: "query",
      }).id,
    );
    expect(r.status).toBe("failed");
    expect(r.error).toEqual({ code: "ZETARIS_OFFLINE", retryable: true });
    expect(r.message).toContain("The data service is unavailable");
    expect(r.evidenceIds).toEqual([]);
    expect(r.answer).toBeUndefined();
  } finally {
    await s.app.close();
  }
});
it("recovers interrupted runs with a readable terminal failure and clears stale answers", async () => {
  const s = await start();
  try {
    const c = await conversation(s);
    const done = await wait(
      s.engine,
      s.engine.createRun(c.id, {
        message: "查询收入",
        patch: { metrics: ["revenue"] },
        taskKind: "query",
      }).id,
    );
    const orphan: Run = {
      ...done,
      id: randomUUID(),
      status: "running",
      finishedAt: undefined,
    };
    s.disk.put("runs", orphan.id, orphan);
    s.engine.recoverInterrupted();
    const r = s.disk.get<Run>("runs", orphan.id);
    expect(r.status).toBe("failed");
    expect(r.error).toEqual({ code: "SERVER_RESTARTED", retryable: true });
    expect(r.answer).toBeUndefined();
    expect(r.progress?.phase).toBe("failed");
  } finally {
    await s.app.close();
  }
});
it("does not fail a completed analysis when optional memory summary persistence fails", async () => {
  const s = await start();
  try {
    vi.spyOn(s.memory, "summarize").mockImplementation(() => {
      throw new Error("private diagnostic");
    });
    const c = await conversation(s);
    const r = await wait(
      s.engine,
      s.engine.createRun(c.id, {
        message: "查询收入",
        patch: { metrics: ["revenue"] },
        taskKind: "query",
      }).id,
    );
    expect(r.status).toBe("completed");
    expect(r.answer).toBeDefined();
    expect(r.warnings).toEqual([
      "Analysis is complete, but this run's memory could not be saved.",
    ]);
    expect(JSON.stringify(r.warnings)).not.toContain("private diagnostic");
  } finally {
    await s.app.close();
  }
});
it("does not automatically repeat a timed-out model request", async () => {
  const saved = settings.nightshiftToken;
  settings.nightshiftToken = "test-only";
  const fetcher = vi.fn(
    async (_url, options) =>
      new Promise<Response>((_resolve, reject) =>
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          { once: true },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  try {
    const traces: any[] = [];
    await expect(
      new Nightshift({ timeoutMs: 20 }).structured(
        "reviewer",
        z.object({}),
        [],
        traces,
      ),
    ).rejects.toMatchObject({ code: "MODEL_TIMEOUT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(traces[0].status).toBe("timeout");
  } finally {
    settings.nightshiftToken = saved;
    vi.unstubAllGlobals();
  }
});

it("accepts bounded extra grounded candidates without allowing invented evidence", () => {
  const ids = Array.from({ length: 8 }, (_, i) => `o-${i}`);
  expect(
    draftSchema.parse({
      observationIds: ids,
      hypothesis: "channel_mix",
      suggestedQuery: null,
    }).observationIds,
  ).toHaveLength(8);
  expect(() => validateSelection(ids, [])).toThrow("unknown observation");
  expect(() =>
    draftSchema.parse({
      observationIds: Array.from({ length: 13 }, (_, i) => `o-${i}`),
      hypothesis: "channel_mix",
      suggestedQuery: null,
    }),
  ).toThrow();
});

it("lets the model plan a grouped first query without changing the user's analysis scope", async () => {
  const scripted = new ScriptedGateway();
  const s = await start({
    gateway: {
      async structured(role, schema, messages, traces, signal) {
        if (role === "investigator.intent")
          return schema.parse({
            kind: "why",
            patch: { metrics: ["spend", "new_users", "revenue"] },
            initialGroupBy: ["channel"],
          });
        return scripted.structured(role, schema, messages, traces, signal);
      },
    },
  });
  try {
    const c = await conversation(s);
    const r = await wait(
      s.engine,
      s.engine.createRun(c.id, { message: "为什么费用与收入变化" }).id,
    );
    expect(r.status).toBe("completed");
    expect(r.context.spec.groupBy).toEqual([]);
    expect(r.evidenceIds).toHaveLength(1);
    expect(s.disk.get<any>("evidence", r.evidenceIds[0]).spec.groupBy).toEqual([
      "channel",
    ]);
    expect(r.modelTraces.some((t) => t.role === "reviewer")).toBe(true);
  } finally {
    await s.app.close();
  }
});
it("rejects an invalid first-query plan before SQL and uses the valid authoritative scope", async () => {
  const scripted = new ScriptedGateway();
  const s = await start({
    gateway: {
      async structured(role, schema, messages, traces, signal) {
        if (role === "investigator.intent")
          return schema.parse({
            kind: "why",
            patch: { metrics: ["spend", "new_users", "revenue"] },
            initialGroupBy: ["device"],
          });
        return scripted.structured(role, schema, messages, traces, signal);
      },
    },
  });
  try {
    const c = await conversation(s);
    const r = await wait(
      s.engine,
      s.engine.createRun(c.id, { message: "为什么费用与收入变化" }).id,
    );
    expect(r.status).toBe("completed");
    expect(
      r.events
        .filter((e) => e.type === "query_started")
        .some((e) => (e.data as any).spec.groupBy.includes("device")),
    ).toBe(false);
    expect(r.evidenceIds).toHaveLength(2);
  } finally {
    await s.app.close();
  }
});

it("runs independent periods concurrently but preserves requested row and query-ID order", async () => {
  let entered = 0,
    release!: () => void;
  const barrier = new Promise<void>((r) => (release = r));
  const completed: string[] = [];
  const analytics = new Analytics(
    {
      kind: "fixture",
      async execute(sql, signal) {
        const june = sql.includes("2019-06-01");
        if (++entered === 2) release();
        await barrier;
        await new Promise((r) => setTimeout(r, june ? 20 : 1));
        const result = await backend.execute(sql, signal);
        completed.push(june ? "june" : "july");
        return { ...result, queryId: june ? "q-june" : "q-july" };
      },
    },
    "runtime-fixture",
  );
  const evidence = await analytics.query({
    ...DEFAULT_SPEC,
    metrics: ["revenue", "spend"],
  });
  expect(completed).toEqual(["july", "june"]);
  expect(evidence.rows.map((r) => r.period)).toEqual(["2019-06", "2019-07"]);
  expect(evidence.queryIds).toEqual(["q-june", "q-july"]);
  expect(evidence.comparisons.find((c) => c.metric === "spend")!.delta).toBe(
    36,
  );
});
it("rejects an immature second period before dispatching any SQL", async () => {
  const execute = vi.fn();
  const analytics = new Analytics(
    { kind: "zetaris", execute },
    "runtime-fixture",
  );
  await expect(
    analytics.query({
      ...DEFAULT_SPEC,
      periods: [
        DEFAULT_SPEC.periods[0],
        { label: "late", start: "2019-10-25", end: "2019-10-28" },
      ],
    }),
  ).rejects.toMatchObject({ code: "IMMATURE_COHORT" });
  expect(execute).not.toHaveBeenCalled();
});
it("aborts the sibling period query when one query fails", async () => {
  let n = 0,
    siblingAborted = false;
  const analytics = new Analytics(
    {
      kind: "zetaris",
      async execute(_sql, signal) {
        if (++n === 1)
          throw new AppError("ZETARIS_OFFLINE", "test outage", 503);
        await new Promise((_resolve, reject) => {
          const abort = () => {
            siblingAborted = true;
            reject(signal!.reason);
          };
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        });
        throw new Error("unreachable");
      },
    },
    "runtime-fixture",
  );
  await expect(analytics.query(DEFAULT_SPEC)).rejects.toMatchObject({
    code: "ZETARIS_OFFLINE",
  });
  expect(siblingAborted).toBe(true);
});

it("publishes retryability in HTTP errors and the OpenAPI contract", async () => {
  let retryable = false;
  const s = await start({
    backend: {
      kind: "zetaris",
      async execute() {
        throw new AppError(
          "TEST_UNAVAILABLE",
          "test transport failure",
          503,
          retryable,
        );
      },
    },
  });
  try {
    for (const value of [false, true]) {
      retryable = value;
      const response = await s.app.inject({
        method: "POST",
        url: "/api/v1/analytics/query",
        payload: DEFAULT_SPEC,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.retryable).toBe(value);
    }
    const bad = await s.app.inject({
      method: "POST",
      url: "/api/v1/analytics/query",
      payload: {},
    });
    expect(bad.json().error.retryable).toBe(false);
    const missing = await s.app.inject("/api/v1/runs/missing");
    expect(missing.json().error.retryable).toBe(false);
    const doc = (await s.app.inject("/api/v1/openapi.json")).json();
    expect(
      doc.components.schemas.Error.properties.error.properties.retryable.type,
    ).toBe("boolean");
  } finally {
    await s.app.close();
  }
});

it("answers an explicit value request without an unnecessary Why review when the model misclassifies it", async () => {
  const roles: string[] = [];
  const s = await start({
    gateway: {
      async structured(role, schema) {
        roles.push(role);
        if (role !== "investigator.intent")
          throw new Error("A value request should only need intent extraction");
        return schema.parse({
          kind: "why",
          patch: {
            mode: "calendar",
            audience: "all",
            periods: [
              { label: "July", start: "2019-07-01", end: "2019-08-01" },
            ],
            metrics: ["revenue"],
          },
        });
      },
    },
  });
  try {
    const c = await conversation(s);
    const r = await wait(
      s.engine,
      s.engine.createRun(c.id, {
        message: "查询2019年7月全部用户自然月收入，只要汇总。",
      }).id,
    );
    expect(r.status).toBe("completed");
    expect(r.context.taskKind).toBe("query");
    expect(roles).toEqual(["investigator.intent"]);
    expect(r.evidenceIds).toHaveLength(1);
    expect(r.answer?.facts.some((f) => f.metric === "revenue")).toBe(true);
  } finally {
    await s.app.close();
  }
});
