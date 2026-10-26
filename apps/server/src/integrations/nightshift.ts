import { z } from "zod";
import { settings, AppError, cleanError } from "../config.ts";
import type { ModelTrace } from "@storewhy/contracts";
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface ModelGateway {
  structured<T>(
    role: string,
    schema: z.ZodType<T>,
    messages: ChatMessage[],
    traces: ModelTrace[],
    signal?: AbortSignal,
  ): Promise<T>;
}
export function parseJson(text: string): unknown {
  let clean = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  const first = clean.indexOf("{"),
    last = clean.lastIndexOf("}");
  if (first >= 0 && last >= first) clean = clean.slice(first, last + 1);
  return JSON.parse(clean);
}
export class Nightshift implements ModelGateway {
  async status() {
    if (!settings.nightshiftToken)
      return { status: "unauthorized", model: settings.model };
    try {
      const r = await fetch(settings.nightshiftUrl + "/models", {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (r.status === 401 || r.status === 403)
        return { status: "unauthorized", model: settings.model };
      if (!r.ok) return { status: "offline", model: settings.model };
      const b: any = await r.json();
      return {
        status: (b.data ?? []).some((m: any) => m.id === settings.model)
          ? "online"
          : "model_unavailable",
        model: settings.model,
      };
    } catch {
      return { status: "offline", model: settings.model };
    }
  }
  private headers() {
    return {
      Authorization: "Bearer " + settings.nightshiftToken,
      "Content-Type": "application/json",
      "meterless-app": "storewhy",
      "meterless-scope": "user",
    };
  }
  constructor(
    readonly options: {
      timeoutMs?: number;
      intentTimeoutMs?: number;
      jsonMode?: boolean;
    } = {},
  ) {}
  async structured<T>(
    role: string,
    schema: z.ZodType<T>,
    messages: ChatMessage[],
    traces: ModelTrace[],
    signal?: AbortSignal,
  ): Promise<T> {
    if (!settings.nightshiftToken)
      throw new AppError(
        "MODEL_UNAUTHORIZED",
        "请在本机配置 Nightshift Runtime token",
        503,
        false,
      );
    const system: ChatMessage = {
      role: "system",
      content:
        "Return ONLY valid JSON conforming to this schema. No markdown, no hidden reasoning, no extra keys. Return data, never schema keywords such as additionalProperties or $schema.\n" +
        JSON.stringify(z.toJSONSchema(schema)),
    };
    const history = [system, ...messages];
    for (let attempt = 0; attempt < 2; attempt++) {
      let body: any;
      let trace!: ModelTrace;
      for (let retry = 0; retry < 2; retry++) {
        signal?.throwIfAborted();
        const start = Date.now();
        const payload = JSON.stringify({
          model: settings.model,
          messages: history,
          max_tokens: 1900,
          temperature: 0.1,
          stream: false,
          reasoning_effort: "none",
          ...(this.options.jsonMode !== false
            ? { response_format: { type: "json_object" } }
            : {}),
        });
        trace = {
          role: role + (attempt ? ":repair" : ""),
          model: settings.model,
          provider: "unresolved",
          durationMs: 0,
          inputChars: payload.length,
          attempt: retry + 1,
          status: "error",
          ...(this.options.jsonMode !== false
            ? { responseFormat: "json_object" as const }
            : {}),
        };
        try {
          const response = await fetch(
            settings.nightshiftUrl + "/chat/completions",
            {
              method: "POST",
              headers: this.headers(),
              body: payload,
              signal: signal
                ? AbortSignal.any([
                    signal,
                    AbortSignal.timeout(
                      role === "investigator.intent"
                        ? (this.options.intentTimeoutMs ?? 30000)
                        : (this.options.timeoutMs ?? 90000),
                    ),
                  ])
                : AbortSignal.timeout(
                    role === "investigator.intent"
                      ? (this.options.intentTimeoutMs ?? 30000)
                      : (this.options.timeoutMs ?? 90000),
                  ),
            },
          );
          if (response.status >= 500 && retry === 0) {
            await response.body?.cancel();
            continue;
          }
          if (!response.ok)
            throw new AppError(
              response.status === 401 || response.status === 403
                ? "MODEL_UNAUTHORIZED"
                : "MODEL_ERROR",
              "Nightshift HTTP " + response.status,
              503,
              response.status !== 401 && response.status !== 403,
            );
          body = await response.json();
          const route = body.meterless?.winning_route ?? {};
          trace.model = route.model ?? body.model ?? settings.model;
          trace.provider = route.provider ?? "unknown";
          if (body.meterless?.receipt_id)
            trace.receiptId = body.meterless.receipt_id;
          trace.status = "ok";
          break;
        } catch (error) {
          if (signal?.aborted) {
            trace.status =
              signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled";
            throw error;
          }
          if (
            error instanceof Error &&
            (error.name === "TimeoutError" || error.name === "AbortError")
          ) {
            trace.status = "timeout";
            throw new AppError(
              "MODEL_TIMEOUT",
              "Nightshift response timed out",
              504,
            );
          }
          if (error instanceof AppError) throw error;
          if (error instanceof TypeError && retry === 0) continue;
          throw new AppError("MODEL_OFFLINE", "Nightshift 未返回有效响应", 503);
        } finally {
          trace.durationMs = Date.now() - start;
          traces.push(trace);
        }
      }
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        trace.status = "error";
        throw new AppError("MODEL_EMPTY", "模型未返回文本内容", 503);
      }
      trace.outputChars = content.length;
      try {
        const parsed = parseJson(content);
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          "additionalProperties" in parsed &&
          typeof (parsed as Record<string, unknown>).additionalProperties ===
            "boolean"
        )
          delete (parsed as Record<string, unknown>).additionalProperties;
        if (
          role === "investigator.intent" &&
          parsed &&
          typeof parsed === "object" &&
          "patch" in parsed
        ) {
          const patch = (parsed as { patch: Record<string, unknown> }).patch;
          if (patch && typeof patch === "object")
            for (const [key, value] of Object.entries(patch))
              if (value === null && key !== "timeGrain") delete patch[key];
        }
        return schema.parse(parsed);
      } catch (error) {
        trace.status = "invalid_json";
        if (error instanceof z.ZodError)
          trace.validationIssues = error.issues
            .slice(0, 6)
            .map((issue) => ({ path: issue.path.join("."), code: issue.code }));
        if (attempt === 1)
          throw new AppError(
            "MODEL_INVALID_JSON",
            "模型指令校验失败：" + cleanError(error),
            503,
          );
        history.push(
          { role: "assistant", content },
          {
            role: "user",
            content:
              "The JSON failed validation. Correct it once, output only the required JSON. Omit optional patch fields that are not needed. windowDays can ONLY be 7 or 14, never null; in calendar mode omit windowDays rather than setting null. " +
              cleanError(error),
          },
        );
      }
    }
    throw new AppError("MODEL_INVALID_JSON", "无法解析模型响应", 503);
  }
}
