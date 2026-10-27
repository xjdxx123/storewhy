import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SPEC,
  METRIC_VERSION,
  type Conversation,
  type InvestigationContext,
  type ContextPatch,
  type AnalysisSpec,
} from "@storewhy/contracts";
import { settings, AppError } from "../config.ts";
export class DiskStore {
  constructor(readonly dir = settings.stateDir) {
    fs.mkdirSync(dir, { recursive: true });
  }
  list<T>(kind: string): T[] {
    const dir = path.join(this.dir, kind);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.get<T>(kind, f.slice(0, -5)));
  }
  private file(kind: string, id: string) {
    if (!/^[a-z0-9-]{1,100}$/i.test(id))
      throw new AppError("INVALID_ID", "Invalid ID");
    const dir = path.join(this.dir, kind);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, id + ".json");
  }
  put<T>(kind: string, id: string, value: T) {
    const file = this.file(kind, id),
      tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  }
  get<T>(kind: string, id: string): T {
    try {
      return JSON.parse(fs.readFileSync(this.file(kind, id), "utf8"));
    } catch (error) {
      if (error instanceof AppError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new AppError("NOT_FOUND", "The record does not exist", 404);
      throw new AppError(
        "STATE_CORRUPT",
        "The local record is corrupted and was not cleared automatically",
        500,
      );
    }
  }
}
export function initialContext(
  conversationId: string,
  datasetVersion: string,
  windowDays: 7 | 14 = 14,
): InvestigationContext {
  return {
    conversationId,
    investigationId: randomUUID(),
    datasetVersion,
    metricVersion: METRIC_VERSION,
    revision: 0,
    spec: { ...structuredClone(DEFAULT_SPEC), windowDays },
    evidenceIds: [],
    lastQuestion: "",
    taskKind: "query",
    objective: "",
  };
}
export function patchSpec(
  spec: AnalysisSpec,
  patch: ContextPatch,
): AnalysisSpec {
  return {
    ...structuredClone(spec),
    ...patch,
    filters: { ...spec.filters, ...patch.filters },
  };
}
export function createConversation(
  store: DiskStore,
  datasetVersion: string,
): Conversation {
  const id = randomUUID();
  const c: Conversation = {
    id,
    context: initialContext(id, datasetVersion),
    runIds: [],
    createdAt: new Date().toISOString(),
  };
  store.put("conversations", id, c);
  return c;
}
