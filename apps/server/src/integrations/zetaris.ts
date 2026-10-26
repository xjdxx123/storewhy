import { randomUUID } from "node:crypto";
import { settings, AppError, cleanError } from "../config.ts";
import { zetarisQueries } from "./query-gate.ts";
export interface SqlResult {
  rows: Record<string, unknown>[];
  queryId: string;
  truncated?: boolean;
}
export interface SqlBackend {
  kind: "zetaris" | "fixture";
  execute(sql: string, signal?: AbortSignal): Promise<SqlResult>;
}
export class ZetarisBackend implements SqlBackend {
  readonly kind = "zetaris" as const;
  async execute(sql: string, signal?: AbortSignal): Promise<SqlResult> {
    const deadline = AbortSignal.timeout(90000);
    const querySignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      return await zetarisQueries.run(
        () => this.request(sql, querySignal),
        querySignal,
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      if (deadline.aborted)
        throw new AppError(
          "ZETARIS_TIMEOUT",
          "Zetaris query deadline exceeded while waiting or executing",
          504,
        );
      throw error;
    }
  }
  async request(sql: string, signal?: AbortSignal): Promise<SqlResult> {
    if (!settings.zetarisKey)
      throw new AppError(
        "ZETARIS_UNAUTHORIZED",
        "Zetaris token is not configured",
        503,
        false,
      );
    const queryId = randomUUID();
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
      : AbortSignal.timeout(90000);
    let response: Response;
    try {
      response = await fetch(settings.zetarisUrl + "/sql-editor/sqls/run", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + settings.zetarisKey,
          "X-Org-ID": settings.orgId,
          "X-Request-ID": queryId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ queryId, sql, source: "SqlEditor", limit: 201 }),
        signal: requestSignal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      )
        throw new AppError(
          "ZETARIS_TIMEOUT",
          "Zetaris response timed out",
          504,
        );
      throw new AppError("ZETARIS_OFFLINE", "Cannot connect to Zetaris", 503);
    }
    if (!response.ok) {
      const detail = cleanError(
        await response.text().catch((error: unknown) => {
          if (signal?.aborted) throw error;
          if (requestSignal.aborted)
            throw new AppError(
              "ZETARIS_TIMEOUT",
              "Zetaris response body timed out",
              504,
            );
          return "The response could not be read";
        }),
      );
      throw new AppError(
        response.status === 401 || response.status === 403
          ? "ZETARIS_UNAUTHORIZED"
          : "ZETARIS_ERROR",
        "Zetaris query failed with HTTP " + response.status + ": " + detail,
        503,
        response.status !== 401 && response.status !== 403,
      );
    }
    let body: any;
    try {
      body = await response.json();
    } catch (error) {
      if (signal?.aborted) throw error;
      if (requestSignal.aborted)
        throw new AppError(
          "ZETARIS_TIMEOUT",
          "Zetaris response body timed out",
          504,
        );
      throw new AppError(
        "ZETARIS_RESULT",
        "Zetaris returned an unreadable response",
        503,
      );
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError(
        "ZETARIS_RESULT",
        "Zetaris returned an invalid API response",
        503,
      );
    if (body.error || body.errorMessage || body.status === "FAILED")
      throw new AppError(
        "ZETARIS_QUERY_FAILED",
        cleanError(body.errorMessage ?? body.error ?? "SQL failed"),
        503,
      );
    const data = body.data ?? body.rows;
    if (!Array.isArray(data))
      throw new AppError(
        "ZETARIS_RESULT",
        "Zetaris did not return the complete result array",
        503,
      );
    const columns =
      body.headers ?? body.columns ?? body.columnNames ?? body.schema;
    const names = Array.isArray(columns)
      ? columns.map((c: any) =>
          typeof c === "string" ? c : (c.name ?? c.columnName),
        )
      : [];
    const rows = data.map((row: any) =>
      Array.isArray(row)
        ? Object.fromEntries(
            row.map((v: any, i: number) => [names[i] ?? String(i), v]),
          )
        : row,
    );
    return {
      rows,
      queryId,
      ...(Number(body.total) > rows.length ? { truncated: true } : {}),
    };
  }
}
