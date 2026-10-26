import { z } from "zod";
import {
  CONTRACT_VERSION,
  analysisSpecSchema,
  messageSchema,
  chartSchema,
  chartResponseSchema,
  followupActionSchema,
  expectedContextSchema,
  explanationSchema,
  runProgressSchema,
} from "@storewhy/contracts";
import { settings } from "./config.ts";
export function openapi() {
  const id = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" },
  };
  const json = (schema: unknown) => ({ "application/json": { schema } });
  const response = (description: string, schema?: unknown) => ({
    description,
    ...(schema ? { content: json(schema) } : {}),
  });
  const body = (schema: unknown) => ({ required: true, content: json(schema) });
  const paths: Record<string, unknown> = {};
  const get = (
    route: string,
    description: string,
    parameters: unknown[] = [],
    schema?: unknown,
  ) =>
    (paths[route] = {
      get: {
        parameters,
        responses: {
          "200": response(description, schema),
          "404": response("Record not found"),
        },
      },
    });
  const post = (
    route: string,
    description: string,
    status = "200",
    schema?: unknown,
    parameters: unknown[] = [],
  ) =>
    (paths[route] = {
      post: {
        parameters,
        ...(schema ? { requestBody: body(schema) } : {}),
        responses: {
          [status]: response(description),
          "400": response("Invalid input"),
          "404": response("Record not found"),
          "409": response("Conversation busy"),
          "429": response("Capacity exceeded"),
          "503": response("Integration unavailable"),
        },
      },
    });
  get("/healthz", "Server health, data mode and contract version");
  get("/api/v1/catalog", "Dataset coverage and metric capabilities");
  get("/api/v1/integrations", "Data and model connection status");
  get("/api/v1/demo", "Self-authored fixture replay; no live agent");
  post(
    "/api/v1/conversations",
    "Conversation with initial analysis scope",
    "201",
  );
  get("/api/v1/conversations/{id}", "Conversation and latest context", [id]);
  post(
    "/api/v1/conversations/{id}/messages",
    "Queued Run; use id for SSE and status",
    "202",
    { $ref: "#/components/schemas/Message" },
    [id],
  );
  get("/api/v1/runs/{id}", "Run status, scope, facts, answer and traces", [id]);
  post(
    "/api/v1/runs/{id}/cancel",
    "Cancellation request or terminal Run",
    "200",
    undefined,
    [id],
  );
  paths["/api/v1/runs/{id}/events"] = {
    get: {
      parameters: [
        id,
        { name: "after", in: "query", schema: { type: "integer", minimum: 0 } },
        { name: "Last-Event-ID", in: "header", schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "Resumable SSE RunEvent stream, then done",
          content: { "text/event-stream": { schema: { type: "string" } } },
        },
      },
    },
  };
  get(
    "/api/v1/evidence/{id}",
    "SQL, queryIds, rows, comparisons and definitions",
    [id],
  );
  get(
    "/api/v1/evidence/{id}/charts",
    "Up to two charts bound to complete source evidence; no new SQL or model call",
    [id],
    { $ref: "#/components/schemas/ChartResponse" },
  );
  post(
    "/api/v1/analytics/query",
    "Evidence for a validated analysis specification",
    "200",
    { $ref: "#/components/schemas/AnalysisSpec" },
  );
  get(
    "/api/v1/conversations/{id}/memory",
    "Scoped memories without embeddings",
    [id],
  );
  post(
    "/api/v1/conversations/{id}/preferences/window",
    "Source-backed default observation window",
    "200",
    {
      type: "object",
      required: ["windowDays"],
      additionalProperties: false,
      properties: { windowDays: { type: "integer", enum: [7, 14] } },
    },
    [id],
  );
  post(
    "/api/v1/conversations/{id}/memory/{memoryId}/feedback",
    "Memory feedback recorded",
    "200",
    {
      type: "object",
      required: ["kind"],
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["helpful", "not_helpful", "wrong"] },
      },
    },
    [
      id,
      {
        name: "memoryId",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
  );
  return {
    openapi: "3.1.0",
    info: { title: "StoreWhy Backend", version: CONTRACT_VERSION },
    servers: [{ url: "http://127.0.0.1:" + settings.port }],
    paths,
    components: {
      schemas: {
        Message: z.toJSONSchema(messageSchema),
        AnalysisSpec: z.toJSONSchema(analysisSpecSchema),
        Chart: z.toJSONSchema(chartSchema),
        ChartResponse: z.toJSONSchema(chartResponseSchema),
        FollowupAction: z.toJSONSchema(followupActionSchema),
        ExpectedContext: z.toJSONSchema(expectedContextSchema),
        Explanation: z.toJSONSchema(explanationSchema),
        RunProgress: z.toJSONSchema(runProgressSchema),
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                retryable: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  };
}
