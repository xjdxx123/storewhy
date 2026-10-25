import { openapi } from "./openapi.ts";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z, ZodError } from "zod";
import {
  API_PREFIX,
  CONTRACT_VERSION,
  analysisSpecSchema,
  messageSchema,
  type Conversation,
  type Run,
  type Evidence,
  type RunEvent,
} from "@storewhy/contracts";
import { settings, AppError, cleanError } from "./config.ts";
import { Analytics } from "./analytics/service.ts";
import { catalog } from "./analytics/catalog.ts";
import { chartsFor } from "./analytics/charts.ts";
import { presentAnswer } from "./analytics/report.ts";
import { type SqlBackend, ZetarisBackend } from "./integrations/zetaris.ts";
import { FixtureBackend } from "./integrations/fixture.ts";
import { type ModelGateway, Nightshift } from "./integrations/nightshift.ts";
import {
  DiskStore,
  createConversation,
  initialContext,
} from "./context/store.ts";
import { MemoryManager } from "./memory/manager.ts";
import { Engine, terminal, factsFor } from "./agents/engine.ts";
import fs from "node:fs/promises";
const params = (input: unknown) =>
  z.record(z.string(), z.string()).parse(input);
export async function buildApp(
  options: {
    backend?: SqlBackend;
    gateway?: ModelGateway;
    stateDir?: string;
    datasetVersion?: string;
  } = {},
) {
  let backend = options.backend;
  let ownedFixture: FixtureBackend | undefined;
  if (!backend) {
    if (settings.mode === "live") backend = new ZetarisBackend();
    else {
      ownedFixture = new FixtureBackend();
      await ownedFixture.initialize();
      backend = ownedFixture;
    }
  }
  let version = options.datasetVersion;
  if (!version) {
    if (backend.kind === "fixture") version = "self-authored-fixture-v1";
    else {
      try {
        version = JSON.parse(
          await fs.readFile("data/manifests/procrastinate.json", "utf8"),
        ).version;
      } catch {
        throw new Error("Run npm run data:prepare before live mode");
      }
    }
  }
  const analytics = new Analytics(backend, version!);
  const disk = new DiskStore(options.stateDir);
  const memory = new MemoryManager(disk.dir, version!);
  const gateway = options.gateway ?? new Nightshift();
  const engine = new Engine(analytics, gateway, disk, memory);
  engine.recoverInterrupted();
  const app = Fastify({ logger: false, bodyLimit: 20000 });
  await app.register(cors, {
    origin: settings.corsOrigins,
    methods: ["GET", "POST", "OPTIONS"],
  });
  app.setErrorHandler((error, _req, reply) => {
    const validation = error instanceof ZodError;
    const e = error as Error & { statusCode?: number };
    reply.code(validation ? 400 : (e.statusCode ?? 500)).send({
      error: {
        code: validation
          ? "INVALID_REQUEST"
          : error instanceof AppError
            ? error.code
            : "INTERNAL_ERROR",
        message: validation
          ? error.issues
              .map((i) => i.path.join(".") + ": " + i.message)
              .join("; ")
          : cleanError(error),
      },
    });
  });
  app.get("/healthz", () => ({
    status: "ok",
    apiVersion: CONTRACT_VERSION,
    dataMode: backend.kind,
    datasetVersion: version,
  }));
  app.get(API_PREFIX + "/catalog", () => catalog(version!, backend.kind));
  app.get(API_PREFIX + "/integrations", async () => {
    const model = await new Nightshift().status();
    let data: { status: string; backend: string } = {
      status: "online",
      backend: backend.kind,
    };
    try {
      await backend.execute("SELECT 1 AS n");
    } catch (error) {
      data = {
        status:
          error instanceof AppError && error.code.includes("UNAUTHORIZED")
            ? "unauthorized"
            : "offline",
        backend: backend.kind,
      };
    }
    return { data, model };
  });
  app.post(API_PREFIX + "/conversations", (_req, reply) =>
    reply.code(201).send(createConversation(disk, version!)),
  );
  app.get(API_PREFIX + "/conversations/:id", (req) =>
    disk.get<Conversation>("conversations", params(req.params).id),
  );
  app.post(API_PREFIX + "/conversations/:id/messages", (req, reply) => {
    const body = messageSchema.parse(req.body);
    return reply.code(202).send(engine.createRun(params(req.params).id, body));
  });
  app.get(API_PREFIX + "/runs/:id", (req) =>
    disk.get<Run>("runs", params(req.params).id),
  );
  app.post(API_PREFIX + "/runs/:id/cancel", (req) =>
    engine.cancel(params(req.params).id),
  );
  app.get(API_PREFIX + "/evidence/:id", (req) =>
    disk.get<Evidence>("evidence", params(req.params).id),
  );
  app.get(API_PREFIX + "/evidence/:id/charts", (req) =>
    chartsFor([disk.get<Evidence>("evidence", params(req.params).id)]),
  );
  app.post(API_PREFIX + "/analytics/query", async (req) => {
    const e = await analytics.query(analysisSpecSchema.parse(req.body));
    disk.put("evidence", e.id, e);
    return e;
  });
  app.get(API_PREFIX + "/conversations/:id/memory", (req) => {
    const id = params(req.params).id;
    disk.get<Conversation>("conversations", id);
    return { memories: memory.list(id) };
  });
  app.post(API_PREFIX + "/conversations/:id/preferences/window", (req) => {
    const id = params(req.params).id;
    const c = disk.get<Conversation>("conversations", id);
    const b = z
      .object({ windowDays: z.union([z.literal(7), z.literal(14)]) })
      .strict()
      .parse(req.body);
    const record = memory.setWindow(
      c.context,
      b.windowDays,
      "user-preference:" + id + ":" + Date.now(),
    );
    return {
      memoryId: record.id,
      windowDays: b.windowDays,
      source: record.source,
    };
  });
  app.post(
    API_PREFIX + "/conversations/:id/memory/:memoryId/feedback",
    (req) => {
      const { id, memoryId } = params(req.params);
      disk.get<Conversation>("conversations", id);
      const b = z
        .object({ kind: z.enum(["helpful", "not_helpful", "wrong"]) })
        .strict()
        .parse(req.body);
      memory.feedback(id, memoryId, b.kind);
      return { ok: true };
    },
  );
  app.get(API_PREFIX + "/runs/:id/events", (req, reply) => {
    const id = params(req.params).id;
    const run = disk.get<Run>("runs", id);
    const rawAfter =
      (req.query as any)?.after ?? req.headers["last-event-id"] ?? 0;
    let seen = z.coerce.number().int().min(0).parse(rawAfter);
    reply.hijack();
    const headers: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(reply.getHeaders()))
      if (value !== undefined)
        headers[key] = Array.isArray(value) ? value.map(String) : String(value);
    reply.raw.writeHead(200, {
      ...headers,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: RunEvent) => {
      if (event.seq <= seen) return;
      seen = event.seq;
      reply.raw.write(
        `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    };
    for (const event of run.events) send(event);
    const finish = () => {
      const current = disk.get<Run>("runs", id);
      if (terminal(current.status)) {
        reply.raw.write(
          `event: done\ndata: ${JSON.stringify({ runId: id, status: current.status })}\n\n`,
        );
        reply.raw.end();
        return true;
      }
      return false;
    };
    if (finish()) return;
    const listener = (event: RunEvent) => {
      send(event);
      finish();
    };
    engine.events.on(id, listener);
    const heartbeat = setInterval(
      () => reply.raw.write(": heartbeat\n\n"),
      15000,
    );
    heartbeat.unref();
    reply.raw.on("close", () => {
      clearInterval(heartbeat);
      engine.events.off(id, listener);
    });
  });
  app.get(API_PREFIX + "/demo", async () => {
    const f = new FixtureBackend();
    try {
      await f.initialize();
      const a = new Analytics(f, "self-authored-fixture-v1");
      const { DEFAULT_SPEC } = await import("@storewhy/contracts");
      const evidence = await a.query(DEFAULT_SPEC);
      disk.put("evidence", evidence.id, evidence);
      const presentation = chartsFor([evidence]);
      const answer = presentAnswer({
        context: initialContext("fixture-demo", "self-authored-fixture-v1"),
        evidence: [evidence],
        facts: factsFor([evidence]),
        ready: false,
      });
      return {
        kind: "fixture_replay",
        notice:
          "自制样例演示；没有调用在线 Agent。新的开放式调查需要 Nightshift。",
        question: "对比样例中两个获客月份的费用与观察期收入",
        evidence,
        answer: {
          ...answer,
          charts: presentation.charts,
          chartNotes: presentation.notes,
          followups: [],
          limitations: [
            "自制样例；没有调用在线模型或 Reviewer。",
            ...answer.limitations,
          ],
          nextSteps: ["创建真实会话并连接 Nightshift 后，可以执行推荐追问。"],
        },
      };
    } finally {
      await f.close();
    }
  });
  app.get(API_PREFIX + "/openapi.json", openapi);
  app.addHook("preClose", async () => {
    await engine.shutdown();
  });
  app.addHook("onClose", async () => {
    await ownedFixture?.close();
  });
  return { app, engine, analytics, disk, memory };
}
