import { randomUUID } from "node:crypto";
import { settings, AppError, cleanError } from "../config.ts";
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
    return this.request(sql, signal);
  }
  async request(sql: string, signal?: AbortSignal): Promise<SqlResult> {
    if (!settings.zetarisKey)
      throw new AppError("ZETARIS_UNAUTHORIZED", "未配置 Zetaris token", 503);
    const queryId = randomUUID();
    const response = await fetch(settings.zetarisUrl + "/sql-editor/sqls/run", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + settings.zetarisKey,
        "X-Org-ID": settings.orgId,
        "X-Request-ID": queryId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ queryId, sql, source: "SqlEditor", limit: 201 }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
        : AbortSignal.timeout(90000),
    });
    if (!response.ok) {
      const detail = cleanError(await response.text());
      throw new AppError(
        response.status === 401 || response.status === 403
          ? "ZETARIS_UNAUTHORIZED"
          : "ZETARIS_ERROR",
        "Zetaris 查询失败 HTTP " + response.status + ": " + detail,
        503,
      );
    }
    const body: any = await response.json();
    if (body.error || body.errorMessage || body.status === "FAILED")
      throw new AppError(
        "ZETARIS_QUERY_FAILED",
        cleanError(body.errorMessage ?? body.error ?? "SQL failed"),
        503,
      );
    const data = body.data ?? body.rows;
    if (!Array.isArray(data))
      throw new AppError("ZETARIS_RESULT", "Zetaris 未返回完整结果数组", 503);
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
