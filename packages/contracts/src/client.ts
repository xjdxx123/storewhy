import type {
  AnalysisSpec,
  ExpectedContext,
  FollowupAction,
  ChartResponse,
  DataCatalog,
  IntegrationStatus,
  MemoryView,
  WindowPreference,
  DemoReplay,
  Conversation,
  ContextPatch,
  Evidence,
  Run,
  RunEvent,
} from "./index.ts";
export class StoreWhyClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "StoreWhyClientError";
  }
}
export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";
export interface SubscribeOptions {
  after?: number;
  onConnectionChange?: (state: ConnectionState) => void;
  onError?: (error: Error) => void;
}
const ended = (run: Run) => run.status !== "queued" && run.status !== "running";
export class StoreWhyClient {
  constructor(
    readonly baseUrl = "http://127.0.0.1:3100",
    readonly requestTimeoutMs = 30000,
  ) {}
  private async request<T>(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    let response: Response;
    const timeout = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      response = await fetch(this.baseUrl + "/api/v1" + path, {
        method: body === undefined ? "GET" : "POST",
        headers:
          body === undefined ? {} : { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: requestSignal,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const timed =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      throw new StoreWhyClientError(
        timed
          ? "连接后端超时，请稍后重试。"
          : "暂时无法连接后端，请检查服务状态。",
        timed ? "REQUEST_TIMEOUT" : "BACKEND_OFFLINE",
        0,
        true,
      );
    }
    let result: any;
    try {
      result = await response.json();
    } catch {
      if (signal?.aborted) throw signal.reason;
      if (timeout.aborted)
        throw new StoreWhyClientError(
          "读取后端响应超时，请稍后重试。",
          "REQUEST_TIMEOUT",
          response.status,
          true,
        );
      throw new StoreWhyClientError(
        "后端返回了无法读取的响应。",
        "INVALID_RESPONSE",
        response.status,
        response.status >= 500,
      );
    }
    if (!result || typeof result !== "object")
      throw new StoreWhyClientError(
        "后端返回了不符合接口约定的响应。",
        "INVALID_RESPONSE",
        response.status,
        response.status >= 500,
      );
    if (!response.ok)
      throw new StoreWhyClientError(
        result.error?.message ?? "Backend request failed",
        result.error?.code ?? "HTTP_ERROR",
        response.status,
        result.error?.retryable ??
          (response.status >= 500 || response.status === 429),
      );
    return result as T;
  }
  createConversation() {
    return this.request<Conversation>("/conversations", {});
  }
  conversation(id: string) {
    return this.request<Conversation>(
      "/conversations/" + encodeURIComponent(id),
    );
  }
  send(
    id: string,
    message: string,
    options: {
      patch?: ContextPatch;
      newInvestigation?: boolean;
      expectedContext?: ExpectedContext;
      taskKind?: "query" | "why" | "followup";
    } = {},
  ) {
    return this.request<Run>(
      "/conversations/" + encodeURIComponent(id) + "/messages",
      { message, ...options },
    );
  }
  followup(action: FollowupAction) {
    return this.send(action.basedOn.conversationId, action.message, {
      patch: action.patch,
      expectedContext: action.basedOn,
      taskKind: action.taskKind,
    });
  }
  run(id: string, options: { signal?: AbortSignal } = {}) {
    return this.request<Run>(
      "/runs/" + encodeURIComponent(id),
      undefined,
      options.signal,
    );
  }
  cancel(id: string) {
    return this.request<Run>("/runs/" + encodeURIComponent(id) + "/cancel", {});
  }
  evidence(id: string) {
    return this.request<Evidence>("/evidence/" + encodeURIComponent(id));
  }
  evidenceCharts(id: string) {
    return this.request<ChartResponse>(
      "/evidence/" + encodeURIComponent(id) + "/charts",
    );
  }
  query(spec: AnalysisSpec) {
    return this.request<Evidence>("/analytics/query", spec, undefined, 360000);
  }
  catalog() {
    return this.request<DataCatalog>("/catalog");
  }
  rememberWindow(id: string, windowDays: 7 | 14) {
    return this.request<WindowPreference>(
      "/conversations/" + encodeURIComponent(id) + "/preferences/window",
      { windowDays },
    );
  }
  integrations() {
    return this.request<IntegrationStatus>("/integrations");
  }
  demo() {
    return this.request<DemoReplay>("/demo");
  }
  memory(id: string) {
    return this.request<{ memories: MemoryView[] }>(
      "/conversations/" + encodeURIComponent(id) + "/memory",
    );
  }
  feedback(
    id: string,
    memoryId: string,
    kind: "helpful" | "not_helpful" | "wrong",
  ) {
    return this.request<{ ok: true }>(
      "/conversations/" +
        encodeURIComponent(id) +
        "/memory/" +
        encodeURIComponent(memoryId) +
        "/feedback",
      { kind },
    );
  }
  async resume(conversationId: string) {
    const conversation = await this.conversation(conversationId);
    const last = conversation.runIds.at(-1);
    const run = last ? await this.run(last) : undefined;
    return { conversation, run, after: run?.events.at(-1)?.seq ?? 0 };
  }
  async waitForRun(
    id: string,
    options: {
      signal?: AbortSignal;
      pollIntervalMs?: number;
      timeoutMs?: number;
    } = {},
  ) {
    const deadline = AbortSignal.timeout(options.timeoutMs ?? 370000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, deadline])
      : deadline;
    const interval = Math.max(
      50,
      Math.min(options.pollIntervalMs ?? 1000, 10000),
    );
    try {
      while (true) {
        signal.throwIfAborted();
        const run = await this.run(id, { signal });
        if (ended(run)) return run;
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(signal.reason);
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, interval);
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      }
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (deadline.aborted)
        throw new StoreWhyClientError(
          "等待调查结果超时；后台任务可通过会话继续恢复。",
          "WAIT_TIMEOUT",
          0,
          true,
        );
      throw error;
    }
  }
  subscribe(
    id: string,
    onEvent: (event: RunEvent) => void,
    onDone?: (data: { runId: string; status: Run["status"] }) => void,
    options: SubscribeOptions = {},
  ) {
    let seen = options.after ?? 0;
    if (!Number.isSafeInteger(seen) || seen < 0)
      throw new Error("after must be a non-negative event sequence");
    let closed = false;
    options.onConnectionChange?.("connecting");
    const source = new EventSource(
      this.baseUrl +
        "/api/v1/runs/" +
        encodeURIComponent(id) +
        "/events" +
        (seen ? "?after=" + seen : ""),
    );
    const close = () => {
      if (closed) return;
      closed = true;
      source.close();
      options.onConnectionChange?.("closed");
    };
    source.addEventListener("open", () => {
      if (!closed) options.onConnectionChange?.("open");
    });
    for (const type of [
      "progress",
      "run_started",
      "scope_updated",
      "hypothesis",
      "query_started",
      "query_completed",
      "review_completed",
      "memory_recalled",
      "answer_ready",
      "clarification",
      "error",
      "cancelled",
    ]) {
      source.addEventListener(type, (event) => {
        if (closed) return;
        if (!("data" in event)) {
          const stopped = source.readyState === 2;
          if (stopped) close();
          else options.onConnectionChange?.("reconnecting");
          options.onError?.(
            new Error(
              stopped
                ? "进度连接已停止，请读取 Run 状态恢复。"
                : "进度连接暂时中断，正在重连；调查仍可通过 Run 状态恢复。",
            ),
          );
          return;
        }
        let data: RunEvent;
        try {
          data = JSON.parse(String(event.data));
        } catch {
          options.onError?.(
            new Error("进度消息无法解析，可读取 Run 状态恢复。"),
          );
          return;
        }
        if (!Number.isSafeInteger(data.seq) || data.seq <= seen) return;
        seen = data.seq;
        onEvent(data);
      });
    }
    source.addEventListener("done", (event) => {
      if (closed) return;
      let data: { runId: string; status: Run["status"] };
      try {
        data = JSON.parse((event as MessageEvent).data);
      } catch {
        options.onError?.(new Error("完成事件无法解析，请重新读取 Run。"));
        close();
        return;
      }
      close();
      onDone?.(data);
    });
    return close;
  }
}
