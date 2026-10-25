import { z } from "zod";

export const CONTRACT_VERSION = "1.0.0";
export const METRIC_VERSION = "procrastinate-v1";
export const metricSchema = z.enum([
  "spend",
  "sessions",
  "users",
  "new_users",
  "payers",
  "purchases",
  "revenue",
  "first_purchase_revenue",
  "repeat_purchase_revenue",
  "payer_rate",
  "revenue_per_user",
  "revenue_per_payer",
  "repeat_payer_rate",
  "cost_per_new_user",
  "revenue_to_spend",
  "avg_first_purchase_hours",
]);
export type Metric = z.infer<typeof metricSchema>;
export const dimensionSchema = z.enum(["channel", "device", "region"]);
export type Dimension = z.infer<typeof dimensionSchema>;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
export const periodSchema = z
  .object({ label: z.string().min(1).max(60), start: date, end: date })
  .strict()
  .refine((p) => p.start < p.end, "end is exclusive and must exceed start");
export const filtersSchema = z
  .object({
    channels: z.array(z.string().max(50)).max(20).default([]),
    devices: z.array(z.string().max(50)).max(10).default([]),
    regions: z.array(z.string().max(50)).max(10).default([]),
  })
  .strict();
export const timeGrainSchema = z.enum(["day", "week", "month"]);
export const analysisSpecSchema = z
  .object({
    timeGrain: timeGrainSchema.nullable().optional(),
    mode: z.enum(["calendar", "cohort"]).default("cohort"),
    periods: z.array(periodSchema).min(1).max(2),
    windowDays: z.union([z.literal(7), z.literal(14)]).default(14),
    audience: z.enum(["paid", "all"]).default("paid"),
    filters: filtersSchema.default({ channels: [], devices: [], regions: [] }),
    groupBy: z.array(dimensionSchema).max(2).default([]),
    metrics: z.array(metricSchema).min(1).max(16),
  })
  .strict();
export type AnalysisSpec = z.infer<typeof analysisSpecSchema>;
export const contextPatchSchema = z
  .object({
    timeGrain: timeGrainSchema.nullable().optional(),
    mode: z.enum(["calendar", "cohort"]).optional(),
    periods: z.array(periodSchema).min(1).max(2).optional(),
    windowDays: z.union([z.literal(7), z.literal(14)]).optional(),
    audience: z.enum(["paid", "all"]).optional(),
    filters: z
      .object({
        channels: z.array(z.string()).optional(),
        devices: z.array(z.string()).optional(),
        regions: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    groupBy: z.array(dimensionSchema).max(2).optional(),
    metrics: z.array(metricSchema).min(1).optional(),
  })
  .strict();
export type ContextPatch = z.infer<typeof contextPatchSchema>;
export const messageSchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    patch: contextPatchSchema.optional(),
    newInvestigation: z.boolean().default(false),
  })
  .strict();
export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "limited"
  | "needs_clarification"
  | "unsupported"
  | "no_data"
  | "failed"
  | "cancelled";
export interface AnalysisRow {
  period: string;
  bucket?: string;
  dimensions: Partial<Record<Dimension, string>>;
  values: Partial<Record<Metric, number | null>>;
}
export interface Coverage {
  period: string;
  requestedStart: string;
  requestedEnd: string;
  effectiveEnd: string;
  excludedUsers: number;
  days: number;
}
export interface Comparison {
  dimensions: Partial<Record<Dimension, string>>;
  bucket?: string;
  metric: Metric;
  baseline: number | null;
  current: number | null;
  delta: number | null;
  relativeChange: number | null;
}
export interface Evidence {
  comparisons: Comparison[];
  id: string;
  datasetVersion: string;
  metricVersion: string;
  spec: AnalysisSpec;
  sql: string[];
  queryIds: string[];
  backend: "zetaris" | "fixture";
  rows: AnalysisRow[];
  coverage: Coverage[];
  definitions: Record<string, string>;
  notes: string[];
  createdAt: string;
  durationMs: number;
  truncated: boolean;
}
export interface Fact {
  id: string;
  evidenceId: string;
  rowIndex: number;
  metric: Metric;
  value: number | null;
  label: string;
}
export interface Finding {
  text: string;
  factIds: string[];
}
export interface Answer {
  summary: string;
  facts: Fact[];
  findings: Finding[];
  checkedExplanations: string[];
  limitations: string[];
  nextSteps: string[];
}
export interface InvestigationContext {
  conversationId: string;
  investigationId: string;
  datasetVersion: string;
  metricVersion: string;
  revision: number;
  spec: AnalysisSpec;
  evidenceIds: string[];
  lastQuestion: string;
  taskKind?: "query" | "why";
  objective?: string;
}
export interface RunEvent {
  seq: number;
  type:
    | "run_started"
    | "scope_updated"
    | "hypothesis"
    | "query_started"
    | "query_completed"
    | "review_completed"
    | "memory_recalled"
    | "answer_ready"
    | "clarification"
    | "error"
    | "cancelled";
  at: string;
  message: string;
  data?: unknown;
}
export interface ModelTrace {
  role: string;
  model: string;
  provider: string;
  durationMs: number;
  receiptId?: string;
}
export interface Run {
  id: string;
  conversationId: string;
  investigationId: string;
  status: RunStatus;
  question: string;
  context: InvestigationContext;
  events: RunEvent[];
  evidenceIds: string[];
  answer?: Answer;
  message?: string;
  modelTraces: ModelTrace[];
  createdAt: string;
  finishedAt?: string;
}
export interface Conversation {
  id: string;
  context: InvestigationContext;
  runIds: string[];
  createdAt: string;
}
export const API_PREFIX = "/api/v1";
export const DEFAULT_SPEC: AnalysisSpec = {
  mode: "cohort",
  periods: [
    { label: "2019-06", start: "2019-06-01", end: "2019-07-01" },
    { label: "2019-07", start: "2019-07-01", end: "2019-08-01" },
  ],
  windowDays: 14,
  audience: "paid",
  filters: { channels: [], devices: [], regions: [] },
  groupBy: [],
  metrics: [
    "spend",
    "new_users",
    "payers",
    "revenue",
    "payer_rate",
    "revenue_per_payer",
    "cost_per_new_user",
    "revenue_to_spend",
  ],
};

export interface DataCatalog {
  dataset: {
    id: string;
    version: string;
    kind: "self_authored_fixture" | "public_teaching_sample";
    start: string;
    acquisitionEndExclusive: string;
    observationEndExclusive: string;
    currency: string;
    timezone: string;
  };
  channels: string[];
  devices: string[];
  regions: string[];
  metrics: { id: Metric; label: string; definition: string }[];
  dimensions: Dimension[];
  windows: (7 | 14)[];
  timeGrains: ("day" | "week" | "month")[];
  trendMode: string;
  attribution: string;
  limitations: string[];
  dateEndIsExclusive: boolean;
}
export interface IntegrationStatus {
  data: {
    status: "online" | "unauthorized" | "offline";
    backend: "zetaris" | "fixture";
  };
  model: {
    status: "online" | "unauthorized" | "offline" | "model_unavailable";
    model: string;
  };
}
export interface MemoryView {
  id: string;
  content: string;
  source: string;
  timestamp: number;
  tags: string[];
  supersededBy?: string;
  [key: string]: unknown;
}
export interface WindowPreference {
  memoryId: string;
  windowDays: 7 | 14;
  source: string;
}
export interface DemoReplay {
  kind: "fixture_replay";
  notice: string;
  question: string;
  evidence: Evidence;
  answer: Answer;
}
