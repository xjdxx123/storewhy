import { it, expect } from "vitest";
import {
  explicitConstraints,
  isScopeOnly,
  protectScopePatch,
  needsDateClarification,
  isDirectDataRequest,
} from "../apps/server/src/context/constraints.ts";
it("asks for sample dates instead of silently substituting current dates", () => {
  expect(needsDateClarification("今年收入")).toBe(true);
  expect(needsDateClarification("2019年六月收入")).toBe(false);
});
it("preserves explicit windows, all-user audience and known country codes", () => {
  expect(explicitConstraints("首周的所有用户", {})).toMatchObject({
    windowDays: 7,
    audience: "all",
    filters: { channels: [] },
  });
  expect(
    explicitConstraints("两周付费比例", {
      metrics: ["revenue"],
      filters: { regions: ["United Kingdom"] },
    }),
  ).toMatchObject({
    windowDays: 14,
    metrics: ["revenue", "payer_rate", "users", "payers"],
    filters: { regions: ["UK"] },
  });
});
it("interprets a continuous trend range without dropping its middle", () => {
  expect(
    explicitConstraints("五月到七月的月度走势", {
      periods: [
        { label: "May", start: "2019-05-01", end: "2019-06-01" },
        { label: "Jul", start: "2019-07-01", end: "2019-08-01" },
      ],
    }),
  ).toMatchObject({
    mode: "calendar",
    timeGrain: "month",
    periods: [{ start: "2019-05-01", end: "2019-08-01" }],
  });
});

it("does not confuse a calendar day with an observation window or erase an explicit channel", () => {
  expect(
    explicitConstraints("2019年7月7日收入", {}).windowDays,
  ).toBeUndefined();
  expect(
    explicitConstraints("只看FaceBoom的所有用户", {
      filters: { channels: ["FaceBoom"] },
    }).filters?.channels,
  ).toEqual(["FaceBoom"]);
  expect(explicitConstraints("所有用户，不包含organic", {}).audience).toBe(
    "paid",
  );
});

it("keeps explicit late-month cohorts from being silently converted to calendar totals", () => {
  expect(
    explicitConstraints("2019年10月下旬的成熟批次，完整两周", {}),
  ).toMatchObject({
    mode: "cohort",
    windowDays: 14,
    periods: [{ start: "2019-10-21", end: "2019-11-01" }],
  });
});

it("distinguishes a scope edit from a new metric question", () => {
  expect(isScopeOnly("只看FaceBoom")).toBe(true);
  expect(isScopeOnly("观察窗口改七天，其他保持")).toBe(true);
  expect(isScopeOnly("只看FaceBoom收入是多少")).toBe(false);
});

it("only applies named scope changes and protects conditions explicitly kept unchanged", () => {
  expect(
    protectScopePatch("清除国家筛选", {
      periods: [{ label: "July", start: "2019-07-01", end: "2019-08-01" }],
      filters: { regions: [], channels: [] },
      metrics: ["spend"],
    }),
  ).toEqual({ filters: { regions: [] } });
  expect(
    protectScopePatch("改成2019年7月，渠道和窗口都保持", {
      periods: [{ label: "July", start: "2019-07-01", end: "2019-08-01" }],
      filters: { channels: [] },
      windowDays: 14,
    }),
  ).toEqual({
    periods: [{ label: "July", start: "2019-07-01", end: "2019-08-01" }],
  });
});

it("keeps an explicitly requested population count alongside revenue without inventing payer or new-user counts", () => {
  expect(
    explicitConstraints("按设备比较收入与人数，其他不变。", {
      metrics: ["revenue"],
    }).metrics,
  ).toEqual(["revenue", "users"]);
  expect(
    explicitConstraints("只列新用户数和收入", {
      metrics: ["new_users", "revenue"],
    }).metrics,
  ).toEqual(["new_users", "revenue"]);
  expect(
    explicitConstraints("比较购买用户数和收入", {
      metrics: ["payers", "revenue"],
    }).metrics,
  ).toEqual(["payers", "revenue"]);
});

it("distinguishes explicit value requests from requests for explanations", () => {
  expect(isDirectDataRequest("这两个渠道的新用户收入和人数分别是多少？")).toBe(
    true,
  );
  expect(isDirectDataRequest("Can you show revenue in July 2019?")).toBe(true);
  expect(isDirectDataRequest("为什么收入变化，分别差多少？")).toBe(false);
  expect(isDirectDataRequest("请解释这些因素分别造成多少差异")).toBe(false);
  expect(isDirectDataRequest("只看FaceBoom，其他不变")).toBe(false);
});

it("keeps English date, channel and window follow-ups attached to the existing objective", () => {
  for (const question of [
    "Focus on FaceBoom. Keep the same dates and the 14-day window after first visit.",
    "Use 7 days after first visit instead. Keep FaceBoom and the same dates.",
    "Switch to RocketSuperAds. Keep September versus August 2019 and the 7-day window after first visit.",
    "Compare July 2019 with June 2019 instead. Keep FaceBoom, the 7-day window and the same behavior metrics. Do not analyze spend.",
  ])
    expect(isScopeOnly(question)).toBe(true);
  expect(isScopeOnly("Why did revenue change on FaceBoom?")).toBe(false);
  expect(
    isScopeOnly("Split revenue into first and subsequent purchases."),
  ).toBe(false);
  expect(
    explicitConstraints("Use 7 days after first visit", { windowDays: 14 })
      .windowDays,
  ).toBe(7);
  expect(
    explicitConstraints("Use a 14-day window after first visit", {
      windowDays: 7,
    }).windowDays,
  ).toBe(14);
});

it("preserves the English conditions explicitly kept by a scope follow-up", () => {
  expect(
    protectScopePatch(
      "Use 7 days after first visit instead. Keep FaceBoom and the same dates.",
      {
        windowDays: 7,
        periods: [{ label: "wrong", start: "2019-08-01", end: "2019-09-01" }],
        filters: { channels: [] },
        metrics: ["spend"],
      },
    ),
  ).toEqual({ windowDays: 7 });
  expect(
    protectScopePatch(
      "Compare July 2019 with June 2019 instead. Keep FaceBoom, the 7-day window and the same behavior metrics. Do not analyze spend.",
      {
        periods: [
          { label: "June", start: "2019-06-01", end: "2019-07-01" },
          { label: "July", start: "2019-07-01", end: "2019-08-01" },
        ],
        filters: { channels: [] },
        windowDays: 14,
        metrics: ["spend"],
      },
    ),
  ).toEqual({
    periods: [
      { label: "June", start: "2019-06-01", end: "2019-07-01" },
      { label: "July", start: "2019-07-01", end: "2019-08-01" },
    ],
  });
});

it("treats an explicit English revenue split as a data request and retains both requested components", () => {
  const text =
    "Split the revenue change into first and subsequent purchase revenue. Keep the same dates.";
  expect(isDirectDataRequest(text)).toBe(true);
  expect(explicitConstraints(text, { metrics: ["spend"] }).metrics).toEqual([
    "spend",
    "first_purchase_revenue",
    "repeat_purchase_revenue",
    "revenue",
  ]);
});

it("retains whole English months instead of accepting the dataset's cost cutoff as the requested end", () => {
  const periods = [
    { label: "September", start: "2019-09-01", end: "2019-10-01" },
    { label: "October", start: "2019-10-01", end: "2019-10-28" },
  ];
  expect(
    explicitConstraints(
      "Now compare October 2019 with September 2019. Keep RocketSuperAds and the 14-day window after first visit.",
      { periods },
    ).periods,
  ).toEqual([periods[0], { ...periods[1], end: "2019-11-01" }]);
  const partial = [
    { label: "October subset", start: "2019-10-01", end: "2019-10-18" },
  ];
  for (const question of [
    "Compare October 1 to October 17, 2019.",
    "Compare 1 October 2019 to 17 October 2019.",
    "Show early October 2019 revenue.",
    "Show the first 17 days of October 2019.",
    "Show October revenue from 2019-10-01 to 2019-10-17.",
  ])
    expect(explicitConstraints(question, { periods: partial }).periods).toEqual(
      partial,
    );
});
