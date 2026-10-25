import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MemoryManager } from "../apps/server/src/memory/manager.ts";
import { initialContext } from "../apps/server/src/context/store.ts";
it("persists source-backed defaults, supersedes corrections, and isolates scopes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storewhy-memory-"));
  try {
    const id = randomUUID(),
      other = randomUUID(),
      context = initialContext(id, "v1");
    const m = new MemoryManager(dir, "v1");
    const old = m.setWindow(context, 14, "user:initial");
    const fresh = m.setWindow(context, 7, "user:correction");
    expect(m.recall(id)).toMatchObject({
      windowDays: 7,
      source: "user:correction",
    });
    expect(m.list(id).find((r) => r.id === old.id)?.supersededBy).toBe(
      fresh.id,
    );
    expect(m.recall(other)).toBeNull();
    expect(new MemoryManager(dir, "v2").recall(id)).toBeNull();
    expect(new MemoryManager(dir, "v1").recall(id)?.windowDays).toBe(7);
    m.feedback(id, fresh.id, "wrong");
    expect(m.recall(id)).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
