import { it, expect, vi, afterEach } from "vitest";
import {
  StoreWhyClient,
  StoreWhyClientError,
} from "@storewhy/contracts/client";
const sources: FakeSource[] = [];
class FakeSource extends EventTarget {
  closed = 0;
  readyState = 0;
  constructor(readonly url: string) {
    super();
    sources.push(this);
  }
  close() {
    this.closed++;
  }
  emit(type: string, data?: unknown) {
    this.dispatchEvent(
      data === undefined
        ? new Event(type)
        : new MessageEvent(type, {
            data: typeof data === "string" ? data : JSON.stringify(data),
          }),
    );
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  sources.length = 0;
});
it("deduplicates replayed progress and distinguishes transport errors from server error events", () => {
  vi.stubGlobal("EventSource", FakeSource);
  const event = vi.fn(),
    done = vi.fn(),
    error = vi.fn(),
    connection = vi.fn();
  const close = new StoreWhyClient().subscribe("run-1", event, done, {
    after: 2,
    onError: error,
    onConnectionChange: connection,
  });
  const s = sources[0];
  expect(s.url).toContain("after=2");
  s.emit("progress", { seq: 2, type: "progress" });
  s.emit("progress", { seq: 3, type: "progress" });
  s.emit("progress", { seq: 3, type: "progress" });
  expect(event).toHaveBeenCalledTimes(1);
  s.emit("error");
  expect(error).toHaveBeenCalledTimes(1);
  s.emit("error", { seq: 4, type: "error", data: { code: "MODEL_TIMEOUT" } });
  expect(event).toHaveBeenCalledTimes(2);
  s.emit("done", { runId: "run-1", status: "failed" });
  close();
  expect(s.closed).toBe(1);
  expect(done).toHaveBeenCalledWith({ runId: "run-1", status: "failed" });
  expect(connection).toHaveBeenCalledWith("reconnecting");
});
it("reports malformed stream data without treating it as an answer", () => {
  vi.stubGlobal("EventSource", FakeSource);
  const event = vi.fn(),
    done = vi.fn(),
    error = vi.fn();
  new StoreWhyClient().subscribe("run-1", event, done, { onError: error });
  sources[0].emit("progress", "bad json");
  expect(event).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledTimes(1);
});
it("never automatically repeats a failed message POST", async () => {
  const fetcher = vi.fn(async () => {
    throw new TypeError("offline");
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(new StoreWhyClient().send("c", "why")).rejects.toMatchObject({
    code: "BACKEND_OFFLINE",
    retryable: true,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("restores the latest run and cursor after a page reload", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes("/conversations/")
              ? { id: "c", runIds: ["old", "latest"] }
              : {
                  id: "latest",
                  status: "running",
                  progress: { label: "核查中" },
                  events: [{ seq: 7 }],
                },
          ),
        ),
    ),
  );
  const restored = await new StoreWhyClient().resume("c");
  expect(restored.run?.id).toBe("latest");
  expect(restored.after).toBe(7);
  expect(restored.run?.progress?.label).toBe("核查中");
});
it("polls to a terminal state when SSE is unavailable", async () => {
  let n = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "r",
            status: ++n === 1 ? "running" : "completed",
          }),
        ),
    ),
  );
  const r = await new StoreWhyClient().waitForRun("r", { pollIntervalMs: 50 });
  expect(r.status).toBe("completed");
  expect(n).toBe(2);
});
it("stops result polling on user abort", async () => {
  const c = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ status: "running" }))),
  );
  const task = new StoreWhyClient().waitForRun("r", {
    signal: c.signal,
    pollIntervalMs: 100,
  });
  setTimeout(() => c.abort(), 10);
  await expect(task).rejects.toMatchObject({ name: "AbortError" });
});
it("reports a waiting deadline while leaving the backend job resumable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ status: "running" }))),
  );
  await expect(
    new StoreWhyClient().waitForRun("r", { timeoutMs: 15 }),
  ).rejects.toMatchObject({ code: "WAIT_TIMEOUT", retryable: true });
});
it("keeps non-JSON backend failures readable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("upstream error", { status: 503 })),
  );
  await expect(new StoreWhyClient().run("r")).rejects.toBeInstanceOf(
    StoreWhyClientError,
  );
  await expect(new StoreWhyClient().run("r")).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
    retryable: true,
    status: 503,
  });
});

it("ignores events queued after unsubscribe", () => {
  vi.stubGlobal("EventSource", FakeSource);
  const event = vi.fn(),
    done = vi.fn(),
    connection = vi.fn();
  const close = new StoreWhyClient().subscribe("r", event, done, {
    onConnectionChange: connection,
  });
  close();
  sources[0].emit("progress", { seq: 1, type: "progress" });
  sources[0].emit("done", { runId: "r", status: "completed" });
  expect(event).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
  sources[0].emit("open");
  expect(connection).not.toHaveBeenCalledWith("open");
});
it("classifies a stalled response body as a timeout after headers arrive", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url, options) =>
        new Response(
          new ReadableStream({
            start(controller) {
              options.signal.addEventListener(
                "abort",
                () => controller.error(options.signal.reason),
                { once: true },
              );
            },
          }),
        ),
    ),
  );
  await expect(
    new StoreWhyClient("http://127.0.0.1:3100", 20).run("r"),
  ).rejects.toMatchObject({ code: "REQUEST_TIMEOUT", retryable: true });
});

it("treats a null JSON response as an invalid backend response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("null", { status: 503 })),
  );
  await expect(new StoreWhyClient().run("r")).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
    status: 503,
    retryable: true,
  });
});

it("reports a permanently closed event stream without claiming reconnection", () => {
  vi.stubGlobal("EventSource", FakeSource);
  const connection = vi.fn(),
    error = vi.fn();
  new StoreWhyClient().subscribe("r", vi.fn(), undefined, {
    onConnectionChange: connection,
    onError: error,
  });
  sources[0].readyState = 2;
  sources[0].emit("error");
  expect(connection).toHaveBeenLastCalledWith("closed");
  expect(connection).not.toHaveBeenCalledWith("reconnecting");
  expect(error.mock.calls[0][0].message).toContain("run");
});
