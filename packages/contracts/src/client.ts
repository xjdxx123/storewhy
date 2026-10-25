import type {
  AnalysisSpec,
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
export class StoreWhyClient {
  constructor(readonly baseUrl = "http://127.0.0.1:3100") {}
  private async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.baseUrl + "/api/v1" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(result.error?.message ?? "Backend request failed"),
        { code: result.error?.code, status: response.status },
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
    options: { patch?: ContextPatch; newInvestigation?: boolean } = {},
  ) {
    return this.request<Run>(
      "/conversations/" + encodeURIComponent(id) + "/messages",
      { message, ...options },
    );
  }
  run(id: string) {
    return this.request<Run>("/runs/" + encodeURIComponent(id));
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
    return this.request<Evidence>("/analytics/query", spec);
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
  subscribe(
    id: string,
    onEvent: (event: RunEvent) => void,
    onDone?: (data: { runId: string; status: Run["status"] }) => void,
  ) {
    const source = new EventSource(
      this.baseUrl + "/api/v1/runs/" + encodeURIComponent(id) + "/events",
    );
    for (const type of [
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
    ])
      source.addEventListener(type, (event) => {
        if ("data" in event) onEvent(JSON.parse(String(event.data)));
      });
    source.addEventListener("done", (event) => {
      source.close();
      onDone?.(JSON.parse((event as MessageEvent).data));
    });
    return () => source.close();
  }
}
