import { z } from "zod";
import {
  contextPatchSchema,
  dimensionSchema,
  metricSchema,
} from "@storewhy/contracts";
export const intentSchema = z
  .object({
    kind: z.enum([
      "query",
      "why",
      "followup",
      "clarify",
      "unsupported",
      "reset",
    ]),
    patch: contextPatchSchema,
    message: z.string().optional(),
  })
  .strict();
export const toolPatchSchema = z
  .object({
    metrics: z.array(metricSchema).min(1).max(16).optional(),
    groupBy: z.array(dimensionSchema).max(2).optional(),
    filters: z
      .object({
        channels: z.array(z.string()).optional(),
        devices: z.array(z.string()).optional(),
        regions: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const draftSchema = z
  .object({
    observationIds: z.array(z.string()).min(1).max(6),
    hypothesis: z.enum([
      "traffic",
      "conversion",
      "repeat",
      "spend_efficiency",
      "channel_mix",
      "maturity",
      "description",
      "insufficient",
    ]),
    suggestedQuery: toolPatchSchema.nullable(),
  })
  .strict();
export const reviewSchema = z
  .object({
    decision: z.enum(["ready", "needs_query", "limited"]),
    reason: z.string().min(1).max(700),
    query: toolPatchSchema.nullable(),
    issues: z.array(z.string().max(400)).max(6),
  })
  .strict();
