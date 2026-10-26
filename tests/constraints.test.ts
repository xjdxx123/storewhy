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
