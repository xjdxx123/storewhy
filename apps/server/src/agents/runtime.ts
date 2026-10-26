import type { Run, RunProgress, TimingStep } from "@storewhy/contracts";
import { AppError, cleanError } from "../config.ts";
export const progress = (
  phase: RunProgress["phase"],
  label: string,
  round?: number,
): RunProgress => ({
  phase,
  label,
  updatedAt: new Date().toISOString(),
  ...(round ? { round } : {}),
});
export function updateTiming(run: Run) {
  run.timing ??= {
    totalMs: 0,
    modelCalls: 0,
    repairCalls: 0,
    sqlCount: 0,
    steps: [],
  };
  run.timing.totalMs = Math.max(
    0,
    Date.parse(run.finishedAt ?? new Date().toISOString()) -
      Date.parse(run.createdAt),
  );
  run.timing.modelCalls = run.modelTraces.length;
  run.timing.repairCalls = run.modelTraces.filter((t) =>
    t.role.includes(":repair"),
  ).length;
}
export async function measure<T>(
  run: Run,
  phase: TimingStep["phase"],
  action: () => Promise<T>,
  signal?: AbortSignal,
  round?: number,
): Promise<T> {
  updateTiming(run);
  const start = performance.now();
  let outcome: TimingStep["outcome"] = "ok";
  try {
    signal?.throwIfAborted();
    const result = await action();
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    outcome =
      signal?.aborted && signal.reason?.name !== "TimeoutError"
        ? "cancelled"
        : "error";
    throw error;
  } finally {
    run.timing!.steps.push({
      phase,
      durationMs: Math.round(performance.now() - start),
      outcome,
      ...(round ? { round } : {}),
    });
    updateTiming(run);
  }
}
export function terminalProgress(run: Run): RunProgress | undefined {
  if (run.status === "queued" || run.status === "running") return;
  if (run.status === "completed" || run.status === "limited")
    return progress(
      "complete",
      run.status === "limited" ? "调查完成，部分解释仍需更多证据" : "调查完成",
    );
  if (run.status === "failed")
    return progress("failed", run.message ?? "本轮未完成，请查看原因");
  if (run.status === "cancelled")
    return progress("cancelled", "本轮调查已取消");
  return progress("needs_input", run.message ?? "需要补充或调整问题");
}
export function queryLabel(spec: Run["context"]["spec"]) {
  if (spec.groupBy.length) {
    const names = { channel: "渠道", device: "设备", region: "国家" };
    return "正在检查" + spec.groupBy.map((d) => names[d]).join("与") + "差异";
  }
  return spec.periods.length === 2 ? "正在比较两个时期" : "正在核算所选时期";
}
export function failureFor(
  error: unknown,
  signal?: AbortSignal,
  cancelled = false,
): {
  status: "cancelled" | "failed" | "unsupported";
  message: string;
  error: { code: string; retryable: boolean };
} {
  if (cancelled)
    return {
      status: "cancelled",
      message: "本轮调查已取消，可以调整条件后重新提问。",
      error: { code: "CANCELLED", retryable: false },
    };
  const runTimeout = signal?.aborted && signal.reason?.name === "TimeoutError";
  const code = runTimeout
    ? "RUN_TIMEOUT"
    : error instanceof AppError
      ? error.code
      : "RUNTIME_ERROR";
  const messages: Record<string, string> = {
    RUN_TIMEOUT: "本轮调查超过时间限制，未生成新的回答。可以缩小范围后重试。",
    MODEL_TIMEOUT: "模型响应超时，本轮未生成新的回答。可以稍后重试。",
    MODEL_OFFLINE: "暂时无法连接模型服务，本轮未完成。请恢复连接后重试。",
    ZETARIS_TIMEOUT: "数据查询超时，本轮未生成新的回答。可以缩小范围后重试。",
    ZETARIS_OFFLINE: "暂时无法连接数据服务，本轮未完成。请恢复连接后重试。",
    MODEL_UNAUTHORIZED: "模型服务尚未授权，请检查本机连接配置。",
    ZETARIS_UNAUTHORIZED: "数据服务尚未授权，请检查本机连接配置。",
    MODEL_INVALID_JSON:
      "模型返回内容未通过校验，本轮未生成可靠回答。可以重试。",
  };
  return {
    status:
      error instanceof AppError && error.statusCode < 500
        ? "unsupported"
        : "failed",
    message: messages[code] ?? cleanError(error),
    error: {
      code,
      retryable:
        runTimeout ||
        (error instanceof AppError &&
          error.retryable &&
          !code.includes("UNAUTHORIZED") &&
          code !== "STATE_CORRUPT"),
    },
  };
}
