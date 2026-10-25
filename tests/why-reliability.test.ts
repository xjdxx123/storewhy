import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_SPEC,
  explanationSchema,
  type Evidence,
} from "@storewhy/contracts";
import { FixtureBackend } from "../apps/server/src/integrations/fixture.ts";
import { Analytics } from "../apps/server/src/analytics/service.ts";
import { factsFor } from "../apps/server/src/agents/engine.ts";
import { explanationsFor } from "../apps/server/src/analytics/explanations.ts";
import { presentAnswer } from "../apps/server/src/analytics/report.ts";
import { observationsFor } from "../apps/server/src/analytics/observations.ts";
import { explicitConstraints } from "../apps/server/src/context/constraints.ts";
import {
  initialContext,
  createConversation,
} from "../apps/server/src/context/store.ts";
import { buildApp } from "../apps/server/src/app.ts";
import { ScriptedGateway, wait } from "./helpers.ts";
let backend: FixtureBackend,
  analytics: Analytics,
  overall: Evidence,
  grouped: Evidence;
beforeAll(async () => {
  backend = new FixtureBackend();
  await backend.initialize();
  analytics = new Analytics(backend, "why-fixture");
  overall = await analytics.query({
    ...DEFAULT_SPEC,
    metrics: [
      ...DEFAULT_SPEC.metrics,
      "users",
      "first_purchase_revenue",
      "repeat_purchase_revenue",
    ],
  });
  grouped = await analytics.query({ ...overall.spec, groupBy: ["channel"] });
});
afterAll(async () => {
  await backend.close();
});
function answer(evidence: Evidence[], objective: string, ready = true) {
  const context = {
    ...initialContext("why", "why-fixture"),
    spec: evidence[0].spec,
    objective,
    taskKind: "why" as const,
  };
  const facts = factsFor(evidence),
    selected = observationsFor(evidence, facts);
  return presentAnswer({ context, evidence, facts, selected, ready });
}
it("does not mark missing metrics as checked or excluded", () => {
  const e = structuredClone(overall);
  e.spec.metrics = ["revenue"];
  e.comparisons = e.comparisons.filter((c) => c.metric === "revenue");
  const explanations = explanationsFor([e], factsFor([e]));
  for (const kind of [
    "traffic",
    "conversion",
    "purchase_value",
    "repeat",
    "spend_efficiency",
    "channel_mix",
  ]) {
    const check = explanations.find((e) => e.kind === kind)!;
    expect(check.status).toBe("not_checked");
    expect(check.factIds).toEqual([]);
  }
});
it("binds every observational support or contradiction to executed facts or coverage metadata", () => {
  const evidence = [overall, grouped],
    facts = factsFor(evidence),
    checks = explanationsFor(evidence, facts);
  for (const check of checks) {
    explanationSchema.parse(check);
    if (["supported", "contradicted"].includes(check.status)) {
      expect(check.evidenceIds.length).toBeGreaterThan(0);
      expect(check.factIds.length + check.coverageRefs.length).toBeGreaterThan(
        0,
      );
      for (const id of check.factIds)
        expect(
          facts.some(
            (f) => f.id === id && check.evidenceIds.includes(f.evidenceId),
          ),
        ).toBe(true);
    }
  }
  expect(checks.find((c) => c.kind === "channel_mix")?.status).toBe(
    "contradicted",
  );
});
it("does not claim a direction check when a denominator is null", () => {
  const e = structuredClone(overall);
  e.comparisons = e.comparisons.map((c) =>
    c.metric === "payer_rate"
      ? { ...c, baseline: null, delta: null, relativeChange: null }
      : c,
  );
  expect(
    explanationsFor([e], factsFor([e])).find((c) => c.kind === "conversion")
      ?.status,
  ).toBe("missing_data");
});
it("does not use truncated evidence to support an explanation", () => {
  const e = { ...grouped, truncated: true };
  expect(
    explanationsFor([e], factsFor([e])).every(
      (c) => c.status === "not_checked",
    ),
  ).toBe(true);
});
it("leads ratio questions with a ratio rather than spend alone", () => {
  const a = answer([overall, grouped], "为什么收入与广告费用比发生变化？");
  expect(a.summary).toContain("收入与记录费用比");
});
it("decomposes first versus subsequent purchase revenue without calling them new versus old customers", () => {
  const a = answer([overall], "为什么收入变化？请区分首次与后续购买收入");
  expect(a.summary).toContain("首次购买收入");
  expect(a.summary).toContain("后续购买收入");
  expect(a.summary).toContain("不等同于新客与老客");
  expect(a.conclusion!.factIds).toHaveLength(6);
});
it("discloses maturity clipping even when the Reviewer says ready", () => {
  const e = structuredClone(overall);
  e.coverage[1].excludedUsers = 4;
  e.coverage[1].effectiveEnd = "2019-07-18";
  const a = answer([e], "为什么收入变化", true);
  expect(a.limitations.some((l) => l.includes("已排除随访不足"))).toBe(true);
  const check = a.explanations!.find((c) => c.kind === "maturity")!;
  expect(check.status).toBe("contradicted");
  expect(check.coverageRefs).toHaveLength(2);
  expect(check.text).toContain("不能证明被排除的新用户表现差");
});
it("does not treat natural-month comparisons as requested time buckets", () => {
  expect(
    explicitConstraints("为什么2019年7月比6月自然月收入变化", {
      mode: "calendar",
      timeGrain: "month",
    }).timeGrain,
  ).toBeNull();
  expect(
    explicitConstraints("按月收入趋势", {
      mode: "calendar",
      timeGrain: "month",
    }).timeGrain,
  ).toBe("month");
});
it.each(["query", "why"] as const)(
  "preserves the objective and Reviewer when a period-only followup is mislabeled %s",
  async (kind) => {
    const dir = mkdtempSync(path.join(tmpdir(), "storewhy-why-regression-"));
    const scripted = new ScriptedGateway();
    const server = await buildApp({
      backend,
      datasetVersion: "why-fixture",
      stateDir: dir,
      gateway: {
        async structured(role, schema, messages, traces, signal) {
          if (
            role === "investigator.intent" &&
            JSON.parse(messages.at(-1)!.content).currentContext.lastQuestion
          )
            return schema.parse({
              kind,
              patch: {
                periods: [
                  { label: "aug", start: "2019-08-01", end: "2019-09-01" },
                ],
                metrics: ["revenue"],
                filters: { channels: [] },
              },
            });
          return scripted.structured(role, schema, messages, traces, signal);
        },
      },
    });
    try {
      const c = createConversation(server.disk, "why-fixture");
      const first = await wait(
        server.engine,
        server.engine.createRun(c.id, { message: "为什么费用与收入变化" }).id,
      );
      const next = await wait(
        server.engine,
        server.engine.createRun(c.id, {
          message: "时期改为2019年8月，其他条件不变。",
        }).id,
      );
      expect(next.context.objective).toBe(first.context.objective);
      expect(next.context.spec.metrics).toEqual(first.context.spec.metrics);
      expect(next.context.taskKind).toBe("why");
      expect(next.modelTraces.some((t) => t.role === "reviewer")).toBe(true);
    } finally {
      await server.app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

it("keeps the whole requested October in scope and lets coverage clip immature users", () => {
  const patch = explicitConstraints(
    "为什么2019年10月与9月新用户首访后14天收入不同",
    {
      periods: [{ label: "oct", start: "2019-10-01", end: "2019-10-28" }],
      metrics: ["new_users"],
    },
  );
  expect(patch.periods![0].end).toBe("2019-11-01");
  expect(patch.metrics).toContain("revenue");
  const explicit = explicitConstraints("2019年10月25日至27日收入", {
    periods: [{ label: "days", start: "2019-10-25", end: "2019-10-28" }],
  });
  expect(explicit.periods![0].start).toBe("2019-10-25");
});

it("does not shorten continuous multi-month trend ranges while normalizing month boundaries", () => {
  const patch = explicitConstraints("查看2019年六月到八月每月收入走势", {
    mode: "calendar",
    timeGrain: "month",
    periods: [{ label: "range", start: "2019-06-01", end: "2019-09-01" }],
  });
  expect(patch.periods![0].end).toBe("2019-09-01");
});

it("limits a Why that a Reviewer approves without any executed explanatory check", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storewhy-ready-regression-"));
  const server = await buildApp({
    backend,
    datasetVersion: "why-fixture",
    stateDir: dir,
    gateway: {
      async structured(role, schema, messages) {
        const d = JSON.parse(messages.at(-1)!.content);
        return schema.parse(
          role === "investigator.intent"
            ? { kind: "why", patch: { metrics: ["revenue"] } }
            : role === "investigator.explain"
              ? {
                  observationIds: [d.observations[0].id],
                  hypothesis: "description",
                  suggestedQuery: null,
                }
              : {
                  decision: "ready",
                  reason: "仅按总收入描述",
                  query: null,
                  issues: [],
                },
        );
      },
    },
  });
  try {
    const c = createConversation(server.disk, "why-fixture");
    const run = await wait(
      server.engine,
      server.engine.createRun(c.id, { message: "为什么收入有变化" }).id,
    );
    expect(run.status).toBe("limited");
    expect(run.answer?.limitations.some((l) => l.includes("尚未检查"))).toBe(
      true,
    );
  } finally {
    await server.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps a numerical conclusion when the selected headline is a coverage warning", () => {
  const e = structuredClone(overall);
  e.coverage[1].excludedUsers = 3;
  const facts = factsFor([e]),
    observations = observationsFor([e], facts);
  const coverage = observations.find((o) => o.kind === "coverage")!;
  const context = {
    ...initialContext("coverage", "why-fixture"),
    spec: e.spec,
    objective: "为什么收入变化",
    taskKind: "why" as const,
  };
  const a = presentAnswer({
    context,
    evidence: [e],
    facts,
    selected: [coverage],
    headlineObservationId: coverage.id,
    ready: false,
  });
  expect(a.summary).toContain("收入");
  expect(a.summary).not.toMatch(/^已排除/);
  expect(a.limitations.some((l) => l.includes("随访不足"))).toBe(true);
});

it("uses paired new-user evidence even when another supplemental query has unpaired users", () => {
  const e = structuredClone(overall);
  e.spec.metrics = ["new_users", "revenue"];
  const supplement = structuredClone(grouped);
  supplement.spec.metrics = ["users", "payer_rate"];
  const checks = explanationsFor([e, supplement], factsFor([e, supplement]));
  expect(["supported", "contradicted"]).toContain(
    checks.find((c) => c.kind === "traffic")!.status,
  );
});

it.each(["每天", "每周", "每月"])(
  "preserves explicit %s trend requests",
  (word) => {
    const grain = word === "每天" ? "day" : word === "每周" ? "week" : "month";
    expect(
      explicitConstraints(`查询2019年7月${word}收入`, {
        mode: "calendar",
        timeGrain: grain,
      }).timeGrain,
    ).toBe(grain);
  },
);

it("does not let cohort intent silently switch the default paid audience without user instruction", () => {
  expect(
    explicitConstraints("为什么2019年8月相较7月美国新用户首访后14天收入变化", {
      mode: "cohort",
      audience: "all",
      metrics: ["revenue"],
    }).audience,
  ).toBeUndefined();
  expect(
    explicitConstraints("所有用户首访后14天收入", {
      mode: "cohort",
      audience: "all",
    }).audience,
  ).toBe("all");
  expect(
    explicitConstraints("包含organic的新用户首访后14天收入", {
      mode: "cohort",
      audience: "all",
    }).audience,
  ).toBe("all");
  expect(
    explicitConstraints("自然月收入", { mode: "calendar", audience: "all" })
      .audience,
  ).toBe("all");
});

it("answers overall ratio questions with complete amount-weighted channel totals", () => {
  const a = answer([grouped], "为什么收入与广告费用比变化");
  expect(a.summary).toMatch(/^所列渠道合计/);
  expect(a.summary).toContain("不是渠道比值平均");
  expect(a.summary).toContain("从0.15625变为0.147059");
  expect(a.conclusion!.factIds.length).toBe(grouped.rows.length * 2);
  const missing = structuredClone(grouped);
  missing.rows[0].values.spend = null;
  expect(
    observationsFor([missing], factsFor([missing])).some(
      (o) => o.kind === "ratio",
    ),
  ).toBe(false);
});
