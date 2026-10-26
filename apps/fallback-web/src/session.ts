import { useEffect, useRef, useState } from "react";
import {
  StoreWhyClient,
  StoreWhyClientError,
} from "@storewhy/contracts/client";
import type {
  AnalysisSpec,
  Conversation,
  DataCatalog,
  Run,
  RunEvent,
} from "@storewhy/contracts";
export const api = new StoreWhyClient(location.origin);
export const isRunning = (run?: Run) =>
  !!run && ["queued", "running"].includes(run.status);
const storageKey = "storewhy-fallback-conversation-v1";
const message = (e: unknown) =>
  e instanceof TypeError
    ? "暂时无法连接本地后端，请确认服务已启动。"
    : e instanceof Error
      ? e.message
      : "请求未完成，请恢复会话后重试。";
function savedId() {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}
function saveId(id: string) {
  try {
    localStorage.setItem(storageKey, id);
  } catch {
    /* The current tab still works without browser storage. */
  }
}
export function useInvestigation() {
  const [conversation, setConversation] = useState<Conversation>();
  const [run, setRun] = useState<Run>();
  const [catalog, setCatalog] = useState<DataCatalog>();
  const [dataMode, setDataMode] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0),
    lock = useRef(false),
    mounted = useRef(true);
  async function restore(fresh = false) {
    if (lock.current) return;
    lock.current = true;
    const token = ++generation.current;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const [health, available] = await Promise.all([
        fetch("/healthz", { signal: AbortSignal.timeout(10000) }).then(
          async (response) => {
            if (!response.ok)
              throw new Error("后端暂时不可用，请确认本地服务已启动。");
            return response.json() as Promise<{ dataMode: string }>;
          },
        ),
        api.catalog(),
      ]);
      const id = fresh ? null : savedId();
      let restored: { conversation: Conversation; run?: Run };
      try {
        restored = id
          ? await api.resume(id)
          : { conversation: await api.createConversation() };
      } catch (e) {
        if (e instanceof StoreWhyClientError && e.status === 404)
          restored = { conversation: await api.createConversation() };
        else throw e;
      }
      if (!mounted.current || generation.current !== token) return;
      setDataMode(health.dataMode);
      setCatalog(available);
      saveId(restored.conversation.id);
      setConversation(restored.conversation);
      setRun(restored.run);
      setUncertain(false);
      setConnection("");
    } catch (e) {
      if (mounted.current && generation.current === token) setError(message(e));
    } finally {
      lock.current = false;
      if (mounted.current && generation.current === token) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void restore();
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (!run || !isRunning(run)) return;
    const id = run.id,
      controller = new AbortController();
    let disposed = false,
      polling = false;
    const apply = (next: Run) => {
      if (disposed) return;
      setRun((current) => {
        if (current?.id !== id) return current;
        if ((next.events.at(-1)?.seq ?? 0) < (current.events.at(-1)?.seq ?? 0))
          return current;
        return next;
      });
    };
    const refresh = async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        const next = await api.run(id, { signal: controller.signal });
        apply(next);
      } catch (e) {
        if (!disposed)
          setConnection(message(e) + " 保留当前调查，正在等待恢复。");
      } finally {
        polling = false;
      }
    };
    const event = (e: RunEvent) => {
      if (disposed) return;
      setRun((current) =>
        current?.id === id && !current.events.some((v) => v.seq === e.seq)
          ? {
              ...current,
              progress: e.progress ?? current.progress,
              events: [...current.events, e],
            }
          : current,
      );
    };
    const stop =
      import.meta.env.VITE_STOREWHY_POLL_ONLY === "true"
        ? () => {}
        : api.subscribe(
            id,
            event,
            () => {
              void refresh();
            },
            {
              after: run.events.at(-1)?.seq ?? 0,
              onConnectionChange: (state) => {
                if (!disposed)
                  setConnection(
                    state === "open"
                      ? ""
                      : state === "connecting"
                        ? "正在连接进度"
                        : "进度连接已中断，正在读取调查状态",
                  );
              },
              onError: () => {
                void refresh();
              },
            },
          );
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    void refresh();
    return () => {
      disposed = true;
      clearInterval(timer);
      controller.abort();
      stop();
    };
    // One subscription per active Run; progress updates must not reopen the connection.
  }, [run?.id, run?.status === "queued" || run?.status === "running"]);
  async function launch(create: () => Promise<Run>) {
    if (lock.current || isRunning(run) || uncertain) return;
    lock.current = true;
    setSubmitting(true);
    setError("");
    setNotice("");
    setRun(undefined);
    const token = ++generation.current;
    try {
      const next = await create();
      if (mounted.current && generation.current === token) {
        setRun(next);
        setConnection("");
      }
    } catch (e) {
      if (!mounted.current || generation.current !== token) return;
      const ambiguous =
        !(e instanceof StoreWhyClientError) ||
        [
          "BACKEND_OFFLINE",
          "REQUEST_TIMEOUT",
          "INVALID_RESPONSE",
          "CONVERSATION_BUSY",
        ].includes(e.code);
      setUncertain(ambiguous);
      setError(
        message(e) +
          (ambiguous
            ? " 提交状态尚未确认，请先点击“恢复会话”，不要重复发送。"
            : ""),
      );
    } finally {
      lock.current = false;
      if (mounted.current && generation.current === token) setSubmitting(false);
    }
  }
  async function cancel() {
    if (!run || !isRunning(run)) return;
    const token = generation.current;
    try {
      const next = await api.cancel(run.id);
      if (mounted.current && generation.current === token)
        setRun((current) => (current?.id === next.id ? next : current));
    } catch (e) {
      if (mounted.current && generation.current === token) setError(message(e));
    }
  }
  async function remember(spec: AnalysisSpec) {
    if (!conversation) return;
    const token = generation.current;
    try {
      const saved = await api.rememberWindow(conversation.id, spec.windowDays);
      if (mounted.current && generation.current === token)
        setNotice(
          `已保存 ${saved.windowDays} 天默认窗口，来源：${saved.source}`,
        );
    } catch (e) {
      if (mounted.current && generation.current === token) setError(message(e));
    }
  }
  return {
    conversation,
    run,
    catalog,
    dataMode,
    loading,
    submitting,
    uncertain,
    error,
    connection,
    notice,
    busy: loading || submitting || isRunning(run),
    restore,
    launch,
    cancel,
    remember,
    spec: run?.context.spec ?? conversation?.context.spec,
  };
}
