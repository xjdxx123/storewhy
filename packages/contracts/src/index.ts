import { z } from "zod";

export const CONTRACT_VERSION = "1.3.0";
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
export const expectedContextSchema = z
  .object({
    conversationId: z.string().min(1),
    investigationId: z.string().min(1),
    datasetVersion: z.string().min(1),
    metricVersion: z.string().min(1),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type ExpectedContext = z.infer<typeof expectedContextSchema>;
export const followupActionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    message: z.string().min(1).max(4000),
    reason: z.string().min(1),
    taskKind: z.enum(["query", "why", "followup"]),
    patch: analysisSpecSchema,
    basedOn: expectedContextSchema,
    evidenceIds: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type FollowupAction = z.infer<typeof followupActionSchema>;
export const messageSchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    patch: contextPatchSchema.optional(),
    newInvestigation: z.boolean().default(false),
    expectedContext: expectedContextSchema.optional(),
    taskKind: z.enum(["query", "why", "followup"]).optional(),
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
export const coverageSchema = z
  .object({
    period: z.string(),
    requestedStart: date,
    requestedEnd: date,
    effectiveEnd: date,
    excludedUsers: z.number().int().nonnegative(),
    days: z.number().int().nonnegative(),
  })
  .strict();
export type Coverage = z.infer<typeof coverageSchema>;
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
export const CHART_VERSION = "1.0.0";
export const chartUnitSchema = z.enum([
  "sample_amount",
  "count",
  "proportion",
  "multiple",
  "hours",
  "sample_amount_per_user",
  "sample_amount_per_payer",
]);
export type ChartUnit = z.infer<typeof chartUnitSchema>;
const chartDimensionsSchema = z
  .object({
    channel: z.string().optional(),
    device: z.string().optional(),
    region: z.string().optional(),
  })
  .strict();
export const chartPointSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    period: z.string(),
    bucket: date.optional(),
    dimensions: chartDimensionsSchema,
    value: z.number().finite().nullable(),
    source: z
      .object({
        evidenceId: z.string().min(1),
        rowIndex: z.number().int().nonnegative(),
        metric: metricSchema,
      })
      .strict(),
  })
  .strict();
export const chartSchema = z
  .object({
    id: z.string().min(1),
    version: z.literal(CHART_VERSION),
    type: z.enum(["bar", "line", "stacked_bar"]),
    title: z.string().min(1),
    xAxis: z
      .object({ label: z.string(), kind: z.enum(["category", "time"]) })
      .strict(),
    yAxis: z
      .object({
        label: z.string(),
        unit: chartUnitSchema,
        zeroBaseline: z.literal(true),
      })
      .strict(),
    missingValues: z.literal("gap"),
    source: z
      .object({
        evidenceId: z.string().min(1),
        datasetVersion: z.string(),
        metricVersion: z.string(),
        backend: z.enum(["zetaris", "fixture"]),
        createdAt: z.string(),
        spec: analysisSpecSchema,
        coverage: z.array(coverageSchema),
        definitions: z.record(z.string(), z.string()),
      })
      .strict(),
    series: z
      .array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            metric: metricSchema,
            period: z.string().optional(),
            dimensions: chartDimensionsSchema.optional(),
            points: z.array(chartPointSchema).min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    notes: z.array(z.string()),
  })
  .strict();
export type ChartPoint = z.infer<typeof chartPointSchema>;
export type Chart = z.infer<typeof chartSchema>;
export const chartResponseSchema = z
  .object({
    charts: z.array(chartSchema).max(2),
    notes: z.array(z.string()),
  })
  .strict();
export type ChartResponse = z.infer<typeof chartResponseSchema>;
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
export const explanationSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum([
      "traffic",
      "conversion",
      "purchase_value",
      "repeat",
      "spend_efficiency",
      "channel_mix",
      "maturity",
    ]),
    claim: z.string().min(1),
    status: z.enum([
      "supported",
      "contradicted",
      "missing_data",
      "not_checked",
    ]),
    text: z.string().min(1),
    factIds: z.array(z.string()),
    evidenceIds: z.array(z.string()),
    coverageRefs: z.array(
      z.object({ evidenceId: z.string(), period: z.string() }).strict(),
    ),
  })
  .strict();
export type Explanation = z.infer<typeof explanationSchema>;
export interface Answer {
  explanations?: Explanation[];
  conclusion?: Finding;
  keyEvidence?: Finding[];
  followups?: FollowupAction[];
  charts?: Chart[];
  chartNotes?: string[];
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
