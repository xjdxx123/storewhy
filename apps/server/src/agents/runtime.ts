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
      run.status === "limited"
        ? "Investigation finished; some explanations still need evidence"
        : "Investigation complete",
    );
  if (run.status === "failed")
    return progress(
      "failed",
      run.message ?? "Investigation incomplete; see the reported reason",
    );
  if (run.status === "cancelled")
    return progress("cancelled", "Investigation cancelled");
  return progress(
    "needs_input",
    run.message ?? "Please clarify or adjust the question",
  );
}
export function queryLabel(spec: Run["context"]["spec"]) {
  if (spec.groupBy.length) {
    const names = { channel: "channel", device: "device", region: "country" };
    return (
      "Checking " +
      spec.groupBy.map((d) => names[d]).join(" and ") +
      " differences"
    );
  }
  return spec.periods.length === 2
    ? "Comparing the two periods"
    : "Calculating the selected period";
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
      message:
        "Investigation cancelled. Adjust the scope and ask again when ready.",
      error: { code: "CANCELLED", retryable: false },
    };
  const runTimeout = signal?.aborted && signal.reason?.name === "TimeoutError";
  const code = runTimeout
    ? "RUN_TIMEOUT"
    : error instanceof AppError
      ? error.code
      : "RUNTIME_ERROR";
  const messages: Record<string, string> = {
    RUN_TIMEOUT:
      "The investigation timed out without a new answer. Narrow the scope and try again.",
    MODEL_TIMEOUT:
      "The model timed out without a new answer. Please try again later.",
    MODEL_OFFLINE:
      "The model service is unavailable. Restore the connection and try again.",
    ZETARIS_TIMEOUT:
      "The data query timed out without a new answer. Narrow the scope and try again.",
    ZETARIS_OFFLINE:
      "The data service is unavailable. Restore the connection and try again.",
    MODEL_UNAUTHORIZED:
      "The model service is not authorized. Check the backend connection settings.",
    ZETARIS_UNAUTHORIZED:
      "The data service is not authorized. Check the backend connection settings.",
    MODEL_INVALID_JSON:
      "The model response failed validation. No reliable answer was generated; you can retry.",
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
