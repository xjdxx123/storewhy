import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FixtureBackend } from "../apps/server/src/integrations/fixture.ts";
import { Analytics } from "../apps/server/src/analytics/service.ts";
import {
  DiskStore,
  createConversation,
} from "../apps/server/src/context/store.ts";
import { Engine } from "../apps/server/src/agents/engine.ts";
import { MemoryManager } from "../apps/server/src/memory/manager.ts";
import { ScriptedGateway, wait } from "./helpers.ts";
import type { Conversation } from "@storewhy/contracts";
let b: FixtureBackend;
let dir: string;
let store: DiskStore;
let memory: MemoryManager;
let engine: Engine;
beforeAll(async () => {
  b = new FixtureBackend();
  await b.initialize();
  dir = mkdtempSync(path.join(tmpdir(), "storewhy-test-"));
  store = new DiskStore(dir);
  memory = new MemoryManager(dir, "fixture-test");
  engine = new Engine(
    new Analytics(b, "fixture-test"),
    new ScriptedGateway(),
    store,
    memory,
  );
});
afterAll(async () => {
  await b.close();
  rmSync(dir, { recursive: true, force: true });
});
describe("multi-agent and context contracts", () => {
  it("executes a genuine reviewer-requested additional query", async () => {
    const c = createConversation(store, "fixture-test");
    const queued = engine.createRun(c.id, { message: "解释费用与收入变化" });
    const r = await wait(engine, queued.id);
    expect(r.status).toBe("completed");
    expect(r.evidenceIds).toHaveLength(2);
    expect(r.events.filter((e) => e.type === "review_completed")).toHaveLength(
      2,
    );
    expect(r.modelTraces.some((t) => t.role === "reviewer")).toBe(true);
  });
  it("inherits filters, replaces horizons and clears only specified filters across turns", async () => {
    const c = createConversation(store, "fixture-test");
    let r = await wait(
      engine,
      engine.createRun(c.id, {
        message: "看费用",
        patch: { metrics: ["new_users", "revenue"] },
      }).id,
    );
    expect(r.status).toBe("completed");
    r = await wait(
      engine,
      engine.createRun(c.id, {
        message: "只看 FaceBoom",
        patch: { filters: { channels: ["FaceBoom"] } },
      }).id,
    );
    expect(r.context.spec.filters.channels).toEqual(["FaceBoom"]);
    r = await wait(
      engine,
      engine.createRun(c.id, { message: "改七天", patch: { windowDays: 7 } })
        .id,
    );
    expect(r.context.spec.windowDays).toBe(7);
    expect(r.context.spec.filters.channels).toEqual(["FaceBoom"]);
    r = await wait(
      engine,
      engine.createRun(c.id, {
        message: "清除渠道",
        patch: { filters: { channels: [] } },
      }).id,
    );
    expect(r.context.spec.filters.channels).toEqual([]);
    expect(new Set(r.evidenceIds)).not.toContain(
      expect.stringContaining("invalid"),
    );
  });
  it("preserves context on invalid cost granularity", async () => {
    const c = createConversation(store, "fixture-test");
    const r = await wait(
      engine,
      engine.createRun(c.id, {
        message: "iPhone 费用",
        patch: { filters: { devices: ["iPhone"] } },
      }).id,
    );
    expect(r.status).toBe("unsupported");
    expect(
      store.get<Conversation>("conversations", c.id).context.spec.filters
        .devices,
    ).toEqual([]);
  });
  it("starts a new investigation without leaking temporary channel filters", async () => {
    const c = createConversation(store, "fixture-test");
    const r = await wait(
      engine,
      engine.createRun(c.id, {
        message: "渠道",
        patch: { filters: { channels: ["TipTop"] }, metrics: ["revenue"] },
      }).id,
    );
    const reset = await wait(
      engine,
      engine.createRun(c.id, {
        message: "新分析",
        newInvestigation: true,
        patch: { metrics: ["revenue"] },
      }).id,
    );
    expect(reset.investigationId).not.toBe(r.investigationId);
    expect(reset.context.spec.filters.channels).toEqual([]);
  });
  it("returns busy rather than racing the same conversation", async () => {
    const c = createConversation(store, "fixture-test");
    const r = engine.createRun(c.id, { message: "调查" });
    expect(() => engine.createRun(c.id, { message: "另一个调查" })).toThrow(
      "当前会话",
    );
    await wait(engine, r.id);
  });
});

it("persists a requested new investigation even when its first question needs clarification", async () => {
  const c = createConversation(store, "fixture-test");
  const before = await wait(
    engine,
    engine.createRun(c.id, {
      message: "渠道",
      patch: { filters: { channels: ["FaceBoom"] }, metrics: ["revenue"] },
    }).id,
  );
  const reset = await wait(
    engine,
    engine.createRun(c.id, {
      message: "今年收入是多少",
      newInvestigation: true,
    }).id,
  );
  expect(reset.status).toBe("needs_clarification");
  const saved = store.get<Conversation>("conversations", c.id);
  expect(saved.context.spec.filters.channels).toEqual([]);
  expect(saved.context.investigationId).not.toBe(before.investigationId);
});
