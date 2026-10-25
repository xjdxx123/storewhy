import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_SPEC,
  followupActionSchema,
  type Evidence,
  type Run,
} from "@storewhy/contracts";
import { StoreWhyClient } from "@storewhy/contracts/client";
import { FixtureBackend } from "../apps/server/src/integrations/fixture.ts";
import { Analytics } from "../apps/server/src/analytics/service.ts";
import { validateSpec } from "../apps/server/src/analytics/compiler.ts";
import { observationsFor } from "../apps/server/src/analytics/observations.ts";
import { presentAnswer } from "../apps/server/src/analytics/report.ts";
import { followupsFor } from "../apps/server/src/analytics/followups.ts";
import { factsFor } from "../apps/server/src/agents/engine.ts";
import { initialContext } from "../apps/server/src/context/store.ts";
import { buildApp } from "../apps/server/src/app.ts";
import { ScriptedGateway, wait } from "./helpers.ts";
let backend: FixtureBackend,
  analytics: Analytics,
  grouped: Evidence,
  overall: Evidence;
let server: Awaited<ReturnType<typeof buildApp>>, dir: string;
beforeAll(async () => {
  backend = new FixtureBackend();
  await backend.initialize();
  analytics = new Analytics(backend, "answers-fixture");
  overall = await analytics.query(DEFAULT_SPEC);
  grouped = await analytics.query({ ...DEFAULT_SPEC, groupBy: ["channel"] });
  dir = mkdtempSync(path.join(tmpdir(), "storewhy-answers-"));
  server = await buildApp({
    backend,
    gateway: new ScriptedGateway(),
    stateDir: dir,
    datasetVersion: "answers-fixture",
  });
});
afterAll(async () => {
  await server.app.close();
  await backend.close();
  rmSync(dir, { recursive: true, force: true });
});
function input() {
  const context = initialContext("conversation", "answers-fixture");
  context.revision = 2;
  const evidence = [overall, grouped],
    facts = factsFor(evidence);
  const observations = observationsFor(evidence, facts);
  const lead = observations.find(
    (o) => o.kind === "joint" && o.focus?.channel === "TipTop",
  )!;
  return { context, evidence, facts, observations, lead };
}
it("leads with a concrete chosen channel finding, binds the summary and deduplicates key evidence", () => {
  const i = input();
  const selected = [
    i.lead,
    ...i.observations.filter((o) => o.kind === "contribution"),
    i.observations[0],
  ];
  const answer = presentAnswer({
    ...i,
    selected,
    headlineObservationId: i.lead.id,
    ready: true,
  });
  expect(answer.summary).toContain("TipTop");
  expect(answer.summary).toContain("费用增加24");
  expect(answer.summary).not.toContain("通过证据审查");
  expect(answer.summary).toBe(answer.conclusion?.text);
  expect(answer.keyEvidence!.length).toBeGreaterThanOrEqual(2);
  expect(answer.keyEvidence!.length).toBeLessThanOrEqual(3);
  for (const finding of [answer.conclusion!, ...answer.keyEvidence!]) {
    expect(finding.factIds.length).toBeGreaterThan(0);
    for (const id of finding.factIds) {
      const fact = answer.facts.find((f) => f.id === id)!;
      const e = i.evidence.find((e) => e.id === fact.evidenceId)!;
      expect(fact.value).toBe(e.rows[fact.rowIndex].values[fact.metric]);
    }
  }
});
it("honors another valid headline and keeps limited conclusions specific", () => {
  const i = input();
  const lead = i.observations.find(
    (o) => o.kind === "joint" && o.focus?.channel === "FaceBoom",
  )!;
  const answer = presentAnswer({
    ...i,
    selected: [lead, i.lead],
    headlineObservationId: lead.id,
    ready: false,
  });
  expect(answer.summary).toContain("FaceBoom");
  expect(answer.summary).toContain("费用增加12");
  expect(answer.summary).toContain("证据缺口");
  expect(answer.conclusion?.factIds).toEqual(lead.factIds);
});
it("recomputes direction and scope rather than carrying over a fixed main-demo conclusion", async () => {
  const e = await analytics.query({
    ...DEFAULT_SPEC,
    periods: [...DEFAULT_SPEC.periods].reverse(),
    filters: { channels: ["FaceBoom"], devices: [], regions: [] },
  });
  const context = {
    ...initialContext("reverse", "answers-fixture"),
    spec: e.spec,
  };
  const answer = presentAnswer({
    context,
    evidence: [e],
    facts: factsFor([e]),
    selected: observationsFor([e], factsFor([e])),
    ready: true,
  });
  expect(answer.summary).toContain("费用减少12");
  expect(answer.summary).toContain("2019-06对比2019-07");
  expect(answer.summary).not.toContain("TipTop");
});
it("gives a concrete summary for a single-period query", async () => {
  const e = await analytics.query({
    ...DEFAULT_SPEC,
    mode: "calendar",
    audience: "all",
    periods: [DEFAULT_SPEC.periods[1]],
    metrics: ["revenue"],
  });
  const answer = presentAnswer({
    context: { ...initialContext("query", "answers-fixture"), spec: e.spec },
    evidence: [e],
    facts: factsFor([e]),
    ready: true,
  });
  expect(answer.summary).toContain(String(e.rows[0].values.revenue));
  expect(answer.conclusion?.factIds).toHaveLength(1);
});
it("reconciles channel amounts and offsets without summing rates", () => {
  const i = input();
  const o = i.observations.find(
    (o) => o.kind === "contribution" && o.metrics[0] === "spend",
  )!;
  expect(o.text).toContain("TipTop增加24");
  expect(o.text).toContain("其余所列渠道合计增加12");
  expect(o.text).toContain("所列渠道合计增加36");
  expect(o.factIds).toHaveLength(4);
  expect(
    i.observations
      .filter((o) => o.kind === "contribution")
      .every((o) => o.metrics.every((m) => m === "spend" || m === "revenue")),
  ).toBe(true);
  const incomplete = structuredClone(grouped);
  incomplete.comparisons.find((c) => c.metric === "spend")!.delta = null;
  expect(
    observationsFor([incomplete], factsFor([incomplete])).some(
      (o) => o.kind === "contribution" && o.metrics.includes("spend"),
    ),
  ).toBe(false);
});
it("returns validated executable followups with complete dates, filters, units and revision", () => {
  const i = input();
  const actions = followupsFor(
    i.context,
    i.evidence,
    i.facts,
    i.lead,
    [],
    i.lead.focus,
  );
  expect(actions.length).toBeGreaterThanOrEqual(2);
  expect(actions.some((a) => a.id === "payer-performance")).toBe(false);
  for (const action of actions) {
    expect(followupActionSchema.safeParse(action).success).toBe(true);
    expect(validateSpec(action.patch)).toEqual(action.patch);
    expect(action.patch.periods).toEqual(i.context.spec.periods);
    expect(action.patch.audience).toBe(i.context.spec.audience);
    expect(action.basedOn.revision).toBe(2);
    expect(action.evidenceIds).toEqual(i.evidence.map((e) => e.id));
    expect(action.message).toContain("2019-06-01");
  }
});
it("does not recommend previously executed composition again, or use history from another dataset", async () => {
  const i = input();
  const history = await analytics.query({
    ...DEFAULT_SPEC,
    metrics: ["first_purchase_revenue", "repeat_purchase_revenue"],
  });
  const actions = followupsFor(
    i.context,
    i.evidence,
    i.facts,
    i.lead,
    [history],
    i.lead.focus,
  );
  expect(actions.some((a) => a.id === "purchase-composition")).toBe(false);
  expect(
    followupsFor(
      i.context,
      i.evidence,
      i.facts,
      i.lead,
      [{ ...history, datasetVersion: "other" }],
      i.lead.focus,
    ).some((a) => a.id === "purchase-composition"),
  ).toBe(true);
});
it("executes two consecutive recommendations and rejects stale sibling actions before changing state", async () => {
  const c = (
    await server.app.inject({ method: "POST", url: "/api/v1/conversations" })
  ).json();
  const first = await wait(
    server.engine,
    server.engine.createRun(c.id, { message: "为什么费用增加" }).id,
  );
  const action = first.answer!.followups!.find(
    (a) => a.id === "purchase-composition",
  )!;
  const queued = await server.app.inject({
    method: "POST",
    url: `/api/v1/conversations/${c.id}/messages`,
    payload: {
      message: action.message,
      patch: action.patch,
      expectedContext: action.basedOn,
      taskKind: action.taskKind,
    },
  });
  expect(queued.statusCode).toBe(202);
  const next = await wait(server.engine, queued.json().id);
  expect(["completed", "limited"]).toContain(next.status);
  expect(next.context.spec.periods).toEqual(first.context.spec.periods);
  expect(next.context.spec.filters).toEqual(first.context.spec.filters);
  expect(next.context.spec.metrics).toContain("repeat_purchase_revenue");
  expect(next.context.taskKind).toBe("query");
  expect(next.answer?.summary).toContain("首次购买收入");
  expect(next.answer?.summary).toContain("后续购买收入");
  const before = server.disk.get<any>("conversations", c.id);
  const stale = await server.app.inject({
    method: "POST",
    url: `/api/v1/conversations/${c.id}/messages`,
    payload: {
      message: action.message,
      patch: action.patch,
      expectedContext: action.basedOn,
      taskKind: action.taskKind,
    },
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().error.code).toBe("STALE_CONTEXT");
  expect(server.disk.get("conversations", c.id)).toEqual(before);
  const secondAction = next.answer!.followups!.find(
    (a) => a.id === "compare-window",
  )!;
  const last = await wait(
    server.engine,
    server.engine.createRun(c.id, {
      message: secondAction.message,
      patch: secondAction.patch,
      expectedContext: secondAction.basedOn,
      taskKind: secondAction.taskKind,
    }).id,
  );
  expect(["completed", "limited"]).toContain(last.status);
  expect(last.context.spec.windowDays).toBe(7);
  expect(
    last.answer?.followups?.some((a) => a.id === "purchase-composition"),
  ).toBe(false);
});
it("sends a typed recommendation through the existing messages API with its context guard", async () => {
  const i = input();
  const action = followupsFor(
    i.context,
    i.evidence,
    i.facts,
    i.lead,
    [],
    i.lead.focus,
  )[0];
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        id: "queued",
        status: "queued",
      } satisfies Partial<Run>),
    ),
  );
  try {
    await new StoreWhyClient("http://example.test").followup(action);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(
      "http://example.test/api/v1/conversations/conversation/messages",
    );
    const body = JSON.parse(String(init?.body));
    expect(body.expectedContext).toEqual(action.basedOn);
    expect(body.patch).toEqual(action.patch);
    expect(body.taskKind).toEqual(action.taskKind);
  } finally {
    spy.mockRestore();
  }
});

it("rejects guards from another conversation, investigation or dataset without allocating a run", async () => {
  const c = (
    await server.app.inject({ method: "POST", url: "/api/v1/conversations" })
  ).json();
  const {
    conversationId,
    investigationId,
    datasetVersion,
    metricVersion,
    revision,
  } = c.context;
  const expected = {
    conversationId,
    investigationId,
    datasetVersion,
    metricVersion,
    revision,
  };
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    const guard = {
      ...expected,
      [key]: key === "revision" ? 123 : "another-context",
    };
    const r = await server.app.inject({
      method: "POST",
      url: `/api/v1/conversations/${c.id}/messages`,
      payload: {
        message: "核查收入",
        patch: { metrics: ["revenue"] },
        expectedContext: guard,
      },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("STALE_CONTEXT");
  }
  expect(server.disk.get<any>("conversations", c.id).runIds).toEqual([]);
});
it("refuses a model headline outside the selected observations", async () => {
  const scripted = new ScriptedGateway();
  const temporary = mkdtempSync(path.join(tmpdir(), "storewhy-headline-"));
  const local = await buildApp({
    backend,
    datasetVersion: "answers-fixture",
    stateDir: temporary,
    gateway: {
      async structured(role, schema, messages, traces, signal) {
        const value = await scripted.structured(
          role,
          schema,
          messages,
          traces,
          signal,
        );
        return role === "investigator.explain"
          ? schema.parse({
              ...(value as object),
              headlineObservationId: "invented",
            })
          : value;
      },
    },
  });
  try {
    const c = (
      await local.app.inject({ method: "POST", url: "/api/v1/conversations" })
    ).json();
    const r = await wait(
      local.engine,
      local.engine.createRun(c.id, { message: "为什么费用增加" }).id,
    );
    expect(r.status).toBe("failed");
    expect(r.answer).toBeUndefined();
    expect(r.message).toContain("结论必须引用");
  } finally {
    await local.app.close();
    rmSync(temporary, { recursive: true, force: true });
  }
});
it("keeps offline answer mocks bound to their embedded fixture evidence", async () => {
  const fs = await import("node:fs/promises");
  const example = JSON.parse(
    await fs.readFile("docs/examples/answer.json", "utf8"),
  );
  expect(example.notice).toContain("no online model");
  expect(example.answer.summary).toBe(example.answer.conclusion.text);
  for (const finding of [
    example.answer.conclusion,
    ...example.answer.keyEvidence,
  ]) {
    for (const id of finding.factIds) {
      const fact = example.answer.facts.find((f: any) => f.id === id);
      const e = example.evidence.find((e: any) => e.id === fact.evidenceId);
      expect(e.backend).toBe("fixture");
      expect(fact.value).toBe(e.rows[fact.rowIndex].values[fact.metric]);
    }
  }
  for (const action of example.answer.followups)
    expect(followupActionSchema.safeParse(action).success).toBe(true);
});

it("names the filtered channel and displays payer-rate changes as percentages and percentage points", async () => {
  const e = await analytics.query({
    ...DEFAULT_SPEC,
    filters: { channels: ["TipTop"], devices: [], regions: [] },
    metrics: ["payer_rate"],
  });
  const facts = factsFor([e]);
  const o = observationsFor([e], facts).find((o) => o.kind === "comparison")!;
  expect(o.text).toContain("TipTop");
  expect(o.text).toContain("75%");
  expect(o.text).toContain("个百分点");
  expect(o.text).not.toContain("0.75变为");
  expect(facts.every((f) => f.label.includes("TipTop"))).toBe(true);
});
it("keeps an explicit Why on the reviewed path when the model misclassifies it as a query", async () => {
  const scripted = new ScriptedGateway();
  const temporary = mkdtempSync(path.join(tmpdir(), "storewhy-explicit-why-"));
  const local = await buildApp({
    backend,
    datasetVersion: "answers-fixture",
    stateDir: temporary,
    gateway: {
      async structured(role, schema, messages, traces, signal) {
        return role === "investigator.intent"
          ? schema.parse({
              kind: "query",
              patch: { metrics: ["spend", "revenue"] },
            })
          : scripted.structured(role, schema, messages, traces, signal);
      },
    },
  });
  try {
    const c = (
      await local.app.inject({ method: "POST", url: "/api/v1/conversations" })
    ).json();
    const r = await wait(
      local.engine,
      local.engine.createRun(c.id, { message: "为何费用增加" }).id,
    );
    expect(r.context.taskKind).toBe("why");
    expect(r.modelTraces.some((t) => t.role === "reviewer")).toBe(true);
    const explicit = await wait(
      local.engine,
      local.engine.createRun(c.id, {
        message: "为什么费用增加",
        patch: { metrics: ["spend", "revenue"] },
        taskKind: "query",
      }).id,
    );
    expect(explicit.context.taskKind).toBe("why");
    expect(explicit.modelTraces.some((t) => t.role === "reviewer")).toBe(true);
  } finally {
    await local.app.close();
    rmSync(temporary, { recursive: true, force: true });
  }
});

it("keeps a query comparison focused on the largest increase before the largest decrease", () => {
  const e = structuredClone(grouped);
  e.spec.metrics = ["revenue"];
  e.rows[2].values.revenue = 42.5;
  e.rows[3].values.revenue = 32.5;
  e.comparisons = [
    {
      dimensions: { channel: "FaceBoom" },
      metric: "revenue",
      baseline: 37.5,
      current: 42.5,
      delta: 5,
      relativeChange: 5 / 37.5,
    },
    {
      dimensions: { channel: "TipTop" },
      metric: "revenue",
      baseline: 52.5,
      current: 32.5,
      delta: -20,
      relativeChange: -20 / 52.5,
    },
  ];
  const answer = presentAnswer({
    context: { ...initialContext("growth", "answers-fixture"), spec: e.spec },
    evidence: [e],
    facts: factsFor([e]),
    ready: true,
  });
  expect(answer.summary).toContain("FaceBoom");
  expect(answer.summary).toContain("差额5");
});

it("honors a recommended new metric query even when its message begins with only this channel", async () => {
  const c = (
    await server.app.inject({ method: "POST", url: "/api/v1/conversations" })
  ).json();
  const first = await wait(
    server.engine,
    server.engine.createRun(c.id, { message: "为什么费用增加" }).id,
  );
  const action = first.answer!.followups!.find(
    (a) => a.id === "focus-channel",
  )!;
  expect(action).toBeDefined();
  const next = await wait(
    server.engine,
    server.engine.createRun(c.id, {
      message: action.message,
      patch: action.patch,
      taskKind: action.taskKind,
      expectedContext: action.basedOn,
    }).id,
  );
  expect(next.context.taskKind).toBe("query");
  expect(next.answer?.summary).toContain("购买用户比例");
  expect(next.answer?.summary).toContain("%");
});
