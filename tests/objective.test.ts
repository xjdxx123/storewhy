import { it, expect } from "vitest";
import { DEFAULT_SPEC } from "@storewhy/contracts";
import { effectiveObjective } from "../apps/server/src/agents/objective.ts";

it("uses the confirmed followup horizon while preserving the historical objective and calendar dates", () => {
  const context = {
    objective: "为什么2019年7月14日获客的新用户首访后14天收入不同？",
    lastQuestion: "窗口改为7天，其他不变。",
    spec: { ...DEFAULT_SPEC, windowDays: 7 as const },
  };
  expect(effectiveObjective(context)).toBe(
    "为什么2019年7月14日获客的新用户首访后7天收入不同？",
  );
  expect(
    effectiveObjective({
      ...context,
      objective: "为什么首访后第一周收入变化？",
    }),
  ).toBe("为什么首访后7天收入变化？");
  expect(
    effectiveObjective({ ...context, objective: "为什么2周收入变化？" }),
  ).toBe("为什么首访后7天收入变化？");
  expect(context.objective).toContain("首访后14天");
  expect(context.spec.windowDays).toBe(7);
  expect(
    effectiveObjective({
      ...context,
      objective: "为什么新用户首周收入不同？",
      spec: DEFAULT_SPEC,
    }),
  ).toBe("为什么新用户首访后14天收入不同？");
  expect(
    effectiveObjective({
      ...context,
      objective: "Why did revenue within two weeks change?",
    }),
  ).toBe("Why did revenue within 7 days change?");
});

it("preserves unsupported multi-window questions and calendar wording instead of silently narrowing them", () => {
  const context = {
    objective: "为什么7天与14天收入不同？",
    lastQuestion: "",
    spec: DEFAULT_SPEC,
  };
  expect(effectiveObjective(context)).toBe(context.objective);
  expect(
    effectiveObjective({ ...context, objective: "为什么17天收入不同？" }),
  ).toBe("为什么17天收入不同？");
  expect(
    effectiveObjective({
      ...context,
      objective: "自然月收入与14天收入有何差异？",
      spec: { ...DEFAULT_SPEC, mode: "calendar" },
    }),
  ).toBe("自然月收入与14天收入有何差异？");
});
