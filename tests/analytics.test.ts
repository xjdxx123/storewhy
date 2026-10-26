import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { DEFAULT_SPEC, type AnalysisSpec } from "@storewhy/contracts";
import { FixtureBackend } from "../apps/server/src/integrations/fixture.ts";
import { Analytics } from "../apps/server/src/analytics/service.ts";
import { validateSpec } from "../apps/server/src/analytics/compiler.ts";
let backend: FixtureBackend;
let analytics: Analytics;
beforeAll(async () => {
  backend = new FixtureBackend();
  await backend.initialize();
  analytics = new Analytics(backend, "fixture-test");
});
afterAll(async () => backend.close());
const spec = (patch: Partial<AnalysisSpec> = {}) => ({
  ...structuredClone(DEFAULT_SPEC),
  ...patch,
});
describe("independent fixture metric checks", () => {
  it("does not multiply costs or purchases across multiple visits", async () => {
    const e = await analytics.query(spec());
    expect(e.rows[0].values).toMatchObject({
      spend: 576,
      new_users: 8,
      payers: 7,
      revenue: 90,
      payer_rate: 0.875,
    });
    expect(e.rows[1].values.spend).toBe(612);
  });
  it("separates first and subsequent purchases", async () => {
    const e = await analytics.query(
      spec({
        metrics: [
          "revenue",
          "first_purchase_revenue",
          "repeat_purchase_revenue",
          "repeat_payer_rate",
        ],
      }),
    );
    for (const r of e.rows)
      expect(
        r.values.first_purchase_revenue! + r.values.repeat_purchase_revenue!,
      ).toBe(r.values.revenue);
    expect(e.rows[0].values.repeat_purchase_revenue).toBe(7.5);
  });
  it("supports channel contribution without duplicating a multi-channel user", async () => {
    const e = await analytics.query(spec({ groupBy: ["channel"] }));
    const rows = e.rows.filter((r) => r.period === "2019-06");
    expect(rows.reduce((s, r) => s + r.values.new_users!, 0)).toBe(8);
    expect(rows.reduce((s, r) => s + r.values.spend!, 0)).toBe(576);
    expect(rows.reduce((s, r) => s + r.values.revenue!, 0)).toBe(90);
  });
  it("supports first-observed device and country behavior without allocating costs", async () => {
    const e = await analytics.query(
      spec({
        groupBy: ["device", "region"],
        metrics: ["users", "payers", "revenue", "payer_rate"],
      }),
    );
    expect(e.rows.length).toBeGreaterThan(1);
    expect(e.rows.every((r) => r.values.spend === undefined)).toBe(true);
  });
  it("has explicit calendar behavior and a conditional purchase delay", async () => {
    const e = await analytics.query(
      spec({
        mode: "calendar",
        audience: "all",
        metrics: [
          "users",
          "new_users",
          "purchases",
          "revenue",
          "avg_first_purchase_hours",
        ],
      }),
    );
    expect(e.rows[0].values.users).toBe(12);
    expect(e.rows[0].values.avg_first_purchase_hours).toBeGreaterThan(0);
  });
  it("excludes immature users and matching spend dates", async () => {
    const e = await analytics.query(
      spec({
        periods: [{ label: "late", start: "2019-10-01", end: "2019-11-01" }],
        metrics: ["new_users", "revenue", "spend"],
      }),
    );
    expect(e.coverage[0]).toMatchObject({
      effectiveEnd: "2019-10-18",
      excludedUsers: 1,
    });
    expect(e.rows[0].values.new_users).toBe(0);
    expect(e.rows[0].values.spend).toBeNull();
  });
  it("returns null for zero payer denominators", async () => {
    const e = await analytics.query(
      spec({
        filters: { channels: ["TipTop"], devices: ["iPhone"], regions: [] },
        metrics: ["users", "payers", "revenue_per_payer"],
      }),
    );
    expect(e.rows[0].values.revenue_per_payer).toBeNull();
  });
  it("rejects unobservable costs and absent click metrics", () => {
    expect(() => validateSpec(spec({ groupBy: ["device"] }))).toThrow("Spend");
    expect(() => validateSpec({ ...spec(), metrics: ["ctr"] })).toThrow();
    expect(() =>
      validateSpec(
        spec({ filters: { channels: ["organic"], devices: [], regions: [] } }),
      ),
    ).toThrow("Organic");
  });
  it("rejects invalid and out-of-range dates, unknown filters and duplicate dimensions", () => {
    expect(() =>
      validateSpec(
        spec({
          periods: [{ label: "bad", start: "2019-02-31", end: "2019-03-02" }],
        }),
      ),
    ).toThrow();
    expect(() =>
      validateSpec(
        spec({
          periods: [{ label: "bad", start: "2026-01-01", end: "2026-02-01" }],
        }),
      ),
    ).toThrow();
    expect(() =>
      validateSpec(
        spec({
          filters: {
            channels: ["x'); DROP TABLE costs;--"],
            devices: [],
            regions: [],
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      validateSpec(spec({ groupBy: ["channel", "channel"] })),
    ).toThrow();
  });
  it("keeps fractional source amounts until after aggregation", async () => {
    await backend.db.query(
      "UPDATE costs SET amount=0.005 WHERE cost_date='2019-06-01'",
    );
    try {
      const e = await analytics.query(spec({ metrics: ["spend"] }));
      expect(e.rows[0].values.spend).toBe(528.01);
    } finally {
      await backend.db.query(
        "UPDATE costs SET amount=CASE WHEN channel='FaceBoom' THEN 16 ELSE 32 END WHERE cost_date='2019-06-01'",
      );
    }
  });
  it("reconciles monthly calendar trends with aggregate totals", async () => {
    const e = await analytics.query(
      spec({
        mode: "calendar",
        audience: "all",
        timeGrain: "month",
        metrics: [
          "users",
          "new_users",
          "payers",
          "purchases",
          "revenue",
          "spend",
        ],
      }),
    );
    const total = await analytics.query(
      spec({
        mode: "calendar",
        audience: "all",
        metrics: [
          "users",
          "new_users",
          "payers",
          "purchases",
          "revenue",
          "spend",
        ],
      }),
    );
    expect(e.rows.map((r) => r.values)).toEqual(
      total.rows.map((r) => r.values),
    );
    expect(e.rows.map((r) => r.bucket)).toEqual(["2019-06-01", "2019-07-01"]);
  });
  it("daily trends preserve additive totals and clarify cohort trend requests", async () => {
    const e = await analytics.query(
      spec({
        mode: "calendar",
        timeGrain: "day",
        metrics: ["new_users", "purchases", "revenue", "spend"],
        periods: [DEFAULT_SPEC.periods[0]],
      }),
    );
    expect(e.rows.reduce((s, r) => s + r.values.spend!, 0)).toBe(576);
    expect(e.rows.reduce((s, r) => s + r.values.new_users!, 0)).toBe(8);
    expect(() => validateSpec(spec({ timeGrain: "month" }))).toThrow(
      "calendar",
    );
  });
  it("binds every result to actual query IDs and a data version", async () => {
    const e = await analytics.query(spec());
    expect(e.queryIds).toHaveLength(2);
    expect(e.sql[0]).toContain("purchase_facts");
    expect(e.datasetVersion).toBe("fixture-test");
    expect(e.backend).toBe("fixture");
  });
});

it("rejects incomplete result columns instead of turning them into zeros", async () => {
  const a = new Analytics(
    {
      kind: "zetaris",
      async execute() {
        return { queryId: "bad-headers", rows: [{ "0": 1 }] };
      },
    },
    "test",
  );
  await expect(a.query(DEFAULT_SPEC)).rejects.toThrow(
    "Expected fields are missing",
  );
});
it("rejects a combined trend result beyond two hundred rows", async () => {
  await backend.db.exec("BEGIN");
  try {
    await backend.db.exec(
      "INSERT INTO costs(cost_date,channel,amount) SELECT d::date,c,1 FROM generate_series('2019-05-01'::date,'2019-05-31'::date,'1 day'::interval) d CROSS JOIN (VALUES ('FaceBoom'),('TipTop'),('YRabbit'),('LeapBob'),('AdNonSense'),('MediaTornado'),('OppleCreativeMedia'),('RocketSuperAds'),('WahooNetBanner'),('lambdaMediaAds')) t(c) ON CONFLICT DO NOTHING",
    );
    await expect(
      analytics.query(
        spec({
          mode: "calendar",
          timeGrain: "day",
          groupBy: ["channel"],
          metrics: ["spend"],
          periods: [
            { label: "a", start: "2019-05-01", end: "2019-05-11" },
            { label: "b", start: "2019-05-11", end: "2019-05-22" },
          ],
        }),
      ),
    ).rejects.toThrow("200 rows");
  } finally {
    await backend.db.exec("ROLLBACK");
  }
});
