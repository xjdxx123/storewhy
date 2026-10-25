import path from "node:path";
import { HMEM } from "@storewhy/hmem";
import { z } from "zod";
import type { InvestigationContext, Run } from "@storewhy/contracts";
import { AppError } from "../config.ts";
export class MemoryManager {
  private engines = new Map<string, HMEM>();
  constructor(
    readonly dir: string,
    readonly version: string,
  ) {}
  private engine(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new AppError("INVALID_ID", "无效会话 ID");
    let m = this.engines.get(id);
    if (!m) {
      m = new HMEM({
        persistDir: path.join(this.dir, "memory", this.version, id),
        actor: "storewhy",
      });
      this.engines.set(id, m);
    }
    return m;
  }
  recall(id: string) {
    const m = this.engine(id);
    const found = m
      .query("observation window days default", {
        chatId: id,
        threshold: 0,
        topN: 100,
      })
      .memories.filter(
        (r) =>
          r.memory.tags.includes("default:window") &&
          !r.memory.supersededBy &&
          !r.memory.tags.includes("review"),
      );
    const latest = found.sort(
      (a, b) =>
        b.memory.timestamp - a.memory.timestamp ||
        Number(b.memory.id.slice(4)) - Number(a.memory.id.slice(4)),
    )[0]?.memory;
    if (!latest) return null;
    const p = z
      .object({
        key: z.literal("windowDays"),
        value: z.union([z.literal(7), z.literal(14)]),
      })
      .safeParse(JSON.parse(latest.content));
    return p.success
      ? { windowDays: p.data.value, memoryId: latest.id, source: latest.source }
      : null;
  }
  setWindow(context: InvestigationContext, windowDays: 7 | 14, source: string) {
    const m = this.engine(context.conversationId);
    const old = m.store
      .all()
      .filter((r) => r.tags.includes("default:window") && !r.supersededBy);
    const record = m.add({
      content: JSON.stringify({ key: "windowDays", value: windowDays }),
      type: "preference",
      layer: "long_term",
      tags: ["default:window", "project:growth", "windowDays"],
      confidence: 1,
      source,
      provenance: {
        origin: "user_correction",
        learnedAt: Date.now(),
        label: "用户明确保存的观察窗口",
      },
      chatId: context.conversationId,
      ...(old.length ? { supersedes: old.at(-1)!.id } : {}),
    });
    for (const r of old) m.store.update(r.id, { supersededBy: record.id });
    return record;
  }
  summarize(run: Run) {
    if (!run.answer || !["completed", "limited"].includes(run.status)) return;
    return this.engine(run.conversationId).add({
      content: run.answer.summary,
      type: "factual",
      layer: "working",
      tags: ["investigation:" + run.investigationId, "dataset:" + this.version],
      source: "run:" + run.id,
      confidence: 0.7,
      chatId: run.conversationId,
      missionId: run.investigationId,
      goalRunId: run.id,
      provenance: {
        origin: "plan_completion",
        learnedAt: Date.now(),
        label: "仅适用于该调查与快照的审查摘要",
        refs: run.evidenceIds,
      },
    });
  }
  list(id: string) {
    return this.engine(id)
      .store.all()
      .map(({ embedding: _embedding, ...r }) => r);
  }
  feedback(
    id: string,
    memoryId: string,
    kind: "helpful" | "not_helpful" | "wrong",
  ) {
    const engine = this.engine(id);
    if (!engine.store.all().some((m) => m.id === memoryId))
      throw new AppError("NOT_FOUND", "记忆记录不存在", 404);
    engine.feedback(memoryId, kind);
  }
}
