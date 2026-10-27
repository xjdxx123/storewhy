import { validateSelection } from "../apps/server/src/analytics/observations.ts";
import { it, expect, afterEach, vi } from "vitest";
import { z } from "zod";
import { ZetarisBackend } from "../apps/server/src/integrations/zetaris.ts";
import { Nightshift } from "../apps/server/src/integrations/nightshift.ts";
import { settings, AppError } from "../apps/server/src/config.ts";
import { Engine } from "../apps/server/src/agents/engine.ts";
import {
  DiskStore,
  createConversation,
} from "../apps/server/src/context/store.ts";
import { MemoryManager } from "../apps/server/src/memory/manager.ts";
import { Analytics } from "../apps/server/src/analytics/service.ts";
import { ScriptedGateway, wait } from "./helpers.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ModelTrace, Run } from "@storewhy/contracts";
const token = settings.nightshiftToken;
const zetarisKey = settings.zetarisKey;
afterEach(() => {
  vi.unstubAllGlobals();
  settings.nightshiftToken = token;
  settings.zetarisKey = zetarisKey;
});
it("repairs malformed JSON once using the live transport contract", async () => {
  settings.nightshiftToken = "test-only";
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "test-only",
            choices: [
              {
                message: {
                  content: ++calls === 1 ? "invalid json" : '{"ok":true}',
                },
              },
            ],
            meterless: {
              winning_route: { provider: "test-only", model: "test-only" },
            },
          }),
          { status: 200 },
        ),
    ),
  );
  const traces: ModelTrace[] = [];
  expect(
    await new Nightshift().structured(
      "test",
      z.object({ ok: z.boolean() }),
      [],
      traces,
    ),
  ).toEqual({ ok: true });
  expect(calls).toBe(2);
  expect(traces[1].role).toBe("test:repair");
  expect(traces.every((t) => t.responseFormat === "json_object")).toBe(true);
});
it("does not retry authentication failures", async () => {
  settings.nightshiftToken = "test-only";
  const fetch = vi.fn(async () => new Response("{}", { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    new Nightshift().structured("test", z.object({}), [], []),
  ).rejects.toThrow("HTTP 401");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects fabricated observation identifiers", () => {
  expect(() => validateSelection(["made-up"], [])).toThrow("does not exist");
});

it("marks interrupted runs as failed after restart and does not invent fallback evidence", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storewhy-failure-"));
  try {
    const store = new DiskStore(dir),
      c = createConversation(store, "test");
    const analytics = new Analytics(
      {
        kind: "zetaris",
        async execute() {
          throw new AppError("ZETARIS_OFFLINE", "test outage", 503);
        },
      },
      "test",
    );
    const engine = new Engine(
      analytics,
      new ScriptedGateway(),
      store,
      new MemoryManager(dir, "test"),
    );
    const r = await wait(
      engine,
      engine.createRun(c.id, { message: "调查" }).id,
    );
    expect(r.status).toBe("failed");
    expect(r.evidenceIds).toEqual([]);
    expect(r.answer).toBeUndefined();
    const orphan: Run = {
      ...r,
      id: randomUUID(),
      status: "running",
      events: [],
    };
    store.put("runs", orphan.id, orphan);
    engine.recoverInterrupted();
    expect(store.get<Run>("runs", orphan.id).status).toBe("failed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("cancels an active model call", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storewhy-cancel-"));
  try {
    const store = new DiskStore(dir),
      c = createConversation(store, "test");
    const engine = new Engine(
      new Analytics(
        {
          kind: "zetaris",
          async execute() {
            throw new Error("must not query");
          },
        },
        "test",
      ),
      {
        async structured(_role, _schema, _messages, _traces, signal) {
          await new Promise((_resolve, reject) => {
            if (signal?.aborted) reject(new Error("cancelled"));
            else
              signal?.addEventListener(
                "abort",
                () => reject(new Error("cancelled")),
                { once: true },
              );
          });
          throw new Error("unreachable");
        },
      },
      store,
      new MemoryManager(dir, "test"),
    );
    const queued = engine.createRun(c.id, { message: "调查" });
    engine.cancel(queued.id);
    const run = await wait(engine, queued.id);
    expect(run.status).toBe("cancelled");
    expect(run.answer).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects a null Zetaris payload with an explicit data error", async () => {
  settings.zetarisKey = "test-only";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("null")),
  );
  await expect(new ZetarisBackend().execute("SELECT 1")).rejects.toMatchObject({
    code: "ZETARIS_RESULT",
    retryable: true,
  });
});
it("preserves the Zetaris HTTP failure when its error body is unreadable", async () => {
  settings.zetarisKey = "test-only";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => {
        throw new TypeError("broken stream");
      },
    })),
  );
  await expect(new ZetarisBackend().execute("SELECT 1")).rejects.toMatchObject({
    code: "ZETARIS_ERROR",
    retryable: true,
  });
});

it("can explicitly disable JSON object requests without accepting multiple JSON alternatives", async () => {
  settings.nightshiftToken = "test-only";
  const fetcher = vi.fn(async (_url, options) => {
    expect(JSON.parse(options.body).response_format).toBeUndefined();
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":true} {"ok":false}' } }],
      }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(
    new Nightshift({ jsonMode: false }).structured(
      "test",
      z.object({ ok: z.boolean() }),
      [],
      [],
    ),
  ).rejects.toMatchObject({ code: "MODEL_INVALID_JSON" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
