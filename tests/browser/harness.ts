import { StoreWhyClient } from "@storewhy/contracts/client";
import type { Run, RunEvent, ContextPatch, Chart } from "@storewhy/contracts";
const api = new StoreWhyClient(location.origin);
const node = (id: string) => document.getElementById(id)!;
let conversationId =
    localStorage.getItem("storewhy-harness-conversation") ?? "",
  current: Run | undefined,
  close: (() => void) | undefined;
let live = false;
const running = (r: Run) => r.status === "queued" || r.status === "running";
function controls(busy: boolean) {
  for (const id of [
    "send",
    "channel",
    "window",
    "missing",
    "remember",
    "reset",
  ])
    (node(id) as HTMLButtonElement).disabled = busy;
  (node("cancel") as HTMLButtonElement).disabled = !busy;
}
function text(id: string, value: string) {
  node(id).textContent = value;
}
function showCharts(charts: Chart[]) {
  node("charts").replaceChildren();
  for (const chart of charts) {
    const wrap = document.createElement("div"),
      label = document.createElement("p");
    label.textContent = chart.title + " · " + chart.yAxis.unit;
    wrap.append(label);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 620 200");
    svg.setAttribute("width", "620");
    svg.setAttribute("height", "200");
    svg.dataset.chartId = chart.id;
    const points = chart.series.flatMap((s) => s.points),
      max = Math.max(
        1,
        ...points
          .filter((p) => p.value !== null)
          .map((p) => Math.abs(p.value!)),
      );
    svg.setAttribute(
      "viewBox",
      `0 0 ${Math.max(620, 30 + points.length * 24)} 200`,
    );
    points.forEach((p, i) => {
      if (p.value === null) return;
      const rect = document.createElementNS(svg.namespaceURI, "rect");
      rect.setAttribute("x", String(15 + i * 24));
      rect.setAttribute("y", String(175 - (150 * Math.abs(p.value)) / max));
      rect.setAttribute("width", "17");
      rect.setAttribute("height", String((150 * Math.abs(p.value)) / max));
      rect.setAttribute("fill", i % 2 ? "#508688" : "#c28b52");
      Object.assign((rect as SVGElement).dataset, {
        evidenceId: p.source.evidenceId,
        rowIndex: String(p.source.rowIndex),
        metric: p.source.metric,
        value: String(p.value),
      });
      svg.append(rect);
    });
    wrap.append(svg);
    node("charts").append(wrap);
  }
}
function showScope(spec: Run["context"]["spec"]) {
  text("scope", JSON.stringify(spec, null, 2));
  text(
    "scope-label",
    `${spec.periods.map((p) => `${p.start} → ${p.end}（结束日不含）`).join(" 对比 ")} · ${spec.mode === "cohort" ? `首访后${spec.windowDays}天` : "自然时期"} · ${spec.audience === "paid" ? "付费渠道" : "包含 organic 的全部用户"} · 渠道:${spec.filters.channels.join("/") || "全部"} · 设备:${spec.filters.devices.join("/") || "全部"} · 国家:${spec.filters.regions.join("/") || "全部"}`,
  );
}
function show(run: Run) {
  current = run;
  text("status", run.status);
  node("status").dataset.runId = run.id;
  text("progress", run.progress?.label ?? run.events.at(-1)?.message ?? "");
  showScope(run.context.spec);
  controls(running(run));
  text("error", "");
  text(
    "summary",
    run.answer?.conclusion?.text ?? run.answer?.summary ?? run.message ?? "",
  );
  node("limitations").replaceChildren();
  for (const limit of run.answer?.limitations ?? []) {
    const li = document.createElement("li");
    li.textContent = limit;
    node("limitations").append(li);
  }
  node("followups").replaceChildren();
  for (const action of run.answer?.followups ?? []) {
    const button = document.createElement("button");
    button.textContent = action.label;
    button.addEventListener("click", () => launch(() => api.followup(action)));
    node("followups").append(button);
  }
  node("evidence").replaceChildren();
  for (const finding of run.answer?.keyEvidence ?? []) {
    const button = document.createElement("button");
    button.className = "evidence";
    button.textContent = finding.text;
    button.addEventListener("click", async () => {
      try {
        const fact = run.answer!.facts.find(
          (f) => f.id === finding.factIds[0],
        )!;
        const evidence = await api.evidence(fact.evidenceId);
        text(
          "sql",
          `${evidence.backend} · ${evidence.id}\n${evidence.queryIds.join("\n")}\n${evidence.sql.join("\n\n")}`,
        );
      } catch (e) {
        fail(e);
      }
    });
    node("evidence").append(button);
  }
  showCharts(run.answer?.charts ?? []);
}
function fail(error: unknown) {
  text("error", error instanceof Error ? error.message : String(error));
  controls(false);
}
function event(e: RunEvent) {
  localStorage.setItem("storewhy-harness-cursor", String(e.seq));
  text("progress", e.progress?.label ?? e.message);
  if (e.type === "memory_recalled") text("memory", "已恢复有来源的窗口偏好");
}
function watch(run: Run, after = 0) {
  close?.();
  close = api.subscribe(
    run.id,
    event,
    async () => {
      show(await api.run(run.id));
    },
    {
      after,
      onConnectionChange: (s) => text("connection", s),
      onError: async () => {
        try {
          const status = await api.run(run.id);
          if (!running(status)) {
            close?.();
            show(status);
          }
        } catch (e) {
          fail(e);
        }
      },
    },
  );
}
async function launch(create: () => Promise<Run>) {
  close?.();
  controls(true);
  text("error", "");
  text("summary", "");
  node("charts").replaceChildren();
  node("evidence").replaceChildren();
  node("followups").replaceChildren();
  try {
    const run = await create();
    localStorage.setItem("storewhy-harness-cursor", "0");
    show(run);
    watch(run);
  } catch (e) {
    fail(e);
  }
}
node("form").addEventListener("submit", (e) => {
  e.preventDefault();
  void launch(() =>
    api.send(conversationId, (node("question") as HTMLInputElement).value),
  );
});
function patch(message: string, value: ContextPatch) {
  return launch(() => api.send(conversationId, message, { patch: value }));
}
node("channel").addEventListener("click", () =>
  patch("只看 FaceBoom", { filters: { channels: ["FaceBoom"] } }),
);
node("window").addEventListener("click", () =>
  patch("窗口改成7天", { windowDays: 7 }),
);
node("missing").addEventListener("click", () =>
  launch(() =>
    api.send(
      conversationId,
      "为什么2019年7月FaceBoom广告CTR下降？请核查曝光点击与素材。",
    ),
  ),
);
node("cancel").addEventListener("click", async () => {
  if (current)
    try {
      await api.cancel(current.id);
    } catch (e) {
      fail(e);
    }
});
node("remember").addEventListener("click", async () => {
  try {
    const p = await api.rememberWindow(conversationId, 7);
    text("memory", `已保存7天偏好 · ${p.source}`);
  } catch (e) {
    fail(e);
  }
});
node("reset").addEventListener("click", () =>
  launch(() =>
    api.send(conversationId, "开始新分析：查询新用户收入", {
      newInvestigation: true,
      taskKind: "query",
      patch: { metrics: ["new_users", "revenue"] },
    }),
  ),
);
async function init() {
  controls(true);
  try {
    const h = await (await fetch("/healthz")).json();
    live = h.dataMode === "zetaris";
    text(
      "mode",
      live
        ? "Live：Zetaris + Nightshift/NVIDIA"
        : "自制 fixture + scripted test gateway（无在线模型）",
    );
    if (conversationId) {
      const restored = await api.resume(conversationId);
      if (restored.run) {
        show(restored.run);
        if (running(restored.run)) watch(restored.run, restored.after);
        return;
      }
    }
    const c = await api.createConversation();
    conversationId = c.id;
    localStorage.setItem("storewhy-harness-conversation", c.id);
    text("status", "ready");
    showScope(c.context.spec);
    controls(false);
  } catch (e) {
    fail(e);
  }
}
void init();
