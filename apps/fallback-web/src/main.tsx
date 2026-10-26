import { useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type {
  Answer,
  AnalysisSpec,
  ContextPatch,
  DemoReplay,
  FollowupAction,
  RunStatus,
} from "@storewhy/contracts";
import { api, useInvestigation, isRunning } from "./session";
import { EvidenceChart, type EvidenceRequest } from "./charts";
import { EvidenceDialog } from "./evidence";
import "./style.css";
const mainQuestion =
  "为什么2019年7月比6月费用增加，新用户首访后14天收入却没有同步增长？";
const statuses: Record<RunStatus, string> = {
  queued: "等待开始",
  running: "调查中",
  completed: "调查完成",
  limited: "部分解释仍需证据",
  needs_clarification: "需要补充信息",
  unsupported: "当前数据无法回答",
  no_data: "此范围没有数据",
  failed: "调查未完成",
  cancelled: "已取消",
};
function Scope({ spec }: { spec?: AnalysisSpec }) {
  return (
    <section className="scope" aria-label="当前分析条件" data-testid="scope">
      <p className="eyebrow">当前分析条件</p>
      {!spec ? (
        <p>连接后读取实际范围</p>
      ) : (
        <>
          <div className="scope-items">
            <span>
              <b>时期</b>
              {spec.periods.map((p) => p.label).join(" → ")}
            </span>
            <span>
              <b>口径</b>
              {spec.mode === "cohort"
                ? `首访后 ${spec.windowDays} 天`
                : `自然时期${spec.timeGrain ? ` · ${({ day: "按日", week: "按周", month: "按月" } as const)[spec.timeGrain]}` : ""}`}
            </span>
            <span>
              <b>人群</b>
              {spec.audience === "paid"
                ? "付费渠道用户"
                : "全部用户（含 organic）"}
            </span>
            <span>
              <b>渠道</b>
              {spec.filters.channels.join("、") || "全部渠道"}
            </span>
          </div>
          <p className="caption">
            {spec.periods.map((p) => `${p.start} 至 ${p.end}`).join("；")}
            ，结束日不含。设备：{spec.filters.devices.join("、") || "全部"} ·
            国家：{spec.filters.regions.join("、") || "全部"}
          </p>
        </>
      )}
    </section>
  );
}
function Report({
  answer,
  open,
  followup,
  disabled,
}: {
  answer: Answer;
  open: (r: EvidenceRequest) => void;
  followup: (a: FollowupAction) => void;
  disabled: boolean;
}) {
  const facts = (ids: string[]) =>
    answer.facts.filter((f) => ids.includes(f.id));
  return (
    <div className="report" data-testid="report">
      <section className="conclusion">
        <p className="eyebrow">调查结论</p>
        <h2>{answer.conclusion?.text ?? answer.summary}</h2>
      </section>
      {(answer.keyEvidence ?? answer.findings).length > 0 && (
        <section>
          <div className="section-heading">
            <h3>关键证据</h3>
            <span className="meta">数字来自实际查询</span>
          </div>
          <div className="key-evidence">
            {(answer.keyEvidence ?? answer.findings).map((finding, i) => (
              <article key={i}>
                <span className="evidence-index">0{i + 1}</span>
                <div>
                  <p>{finding.text}</p>
                  <div className="fact-links">
                    {facts(finding.factIds).map((f) => (
                      <button
                        key={f.id}
                        className="text-button"
                        onClick={() =>
                          open({
                            id: f.evidenceId,
                            rowIndex: f.rowIndex,
                            metric: f.metric,
                          })
                        }
                      >
                        查看依据 · {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="chart-grid">
        {(answer.charts ?? []).map((chart) => (
          <EvidenceChart key={chart.id} chart={chart} open={open} />
        ))}
      </div>
      {(answer.chartNotes ?? []).map((note, i) => (
        <p className="caption" key={i}>
          {note}
        </p>
      ))}
      {(answer.explanations ?? []).length > 0 && (
        <section>
          <h3>检查了哪些解释</h3>
          <p className="caption">
            支持与反驳描述观测结果，不代表已证明因果关系。
          </p>
          <div className="explanations">
            {answer.explanations!.map((e) => (
              <article key={e.id}>
                <span className={`badge ${e.status}`}>
                  {
                    (
                      {
                        supported: "观测支持",
                        contradicted: "观测反驳",
                        missing_data: "缺少数据",
                        not_checked: "尚未检查",
                      } as const
                    )[e.status]
                  }
                </span>
                <div>
                  <h4>{e.claim}</h4>
                  <p>{e.text}</p>
                  <div className="fact-links">
                    {e.evidenceIds.map((id) => (
                      <button
                        key={id}
                        className="text-button"
                        onClick={() => open({ id })}
                      >
                        查看证据
                      </button>
                    ))}
                    {e.coverageRefs.map((c) => (
                      <button
                        key={`${c.evidenceId}-${c.period}`}
                        className="text-button"
                        onClick={() => open({ id: c.evidenceId })}
                      >
                        查看 {c.period} 覆盖
                      </button>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {answer.limitations.length > 0 && (
        <section className="limitations">
          <h3>仍需注意</h3>
          <ul>
            {answer.limitations.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      {(answer.followups ?? []).length > 0 ? (
        <section>
          <h3>继续追问</h3>
          <div className="followups">
            {answer.followups!.map((action) => (
              <button
                key={action.id}
                disabled={disabled}
                onClick={() => followup(action)}
              >
                <strong>
                  {action.label}
                  <span aria-hidden="true"> ↗</span>
                </strong>
                <span>{action.reason}</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        answer.nextSteps.length > 0 && (
          <section>
            <h3>可以继续检查</h3>
            <ul>
              {answer.nextSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ul>
          </section>
        )
      )}
    </div>
  );
}
function App() {
  const session = useInvestigation();
  const [question, setQuestion] = useState(mainQuestion),
    [demo, setDemo] = useState<DemoReplay>();
  const [demoBusy, setDemoBusy] = useState(false),
    [pageError, setPageError] = useState("");
  const [source, setSource] = useState<EvidenceRequest>();
  const { run, conversation } = session;
  const busy = session.busy || demoBusy;
  const disabled = busy || session.uncertain || !conversation || !!demo;
  const report = demo?.answer ?? run?.answer;
  const spec = demo?.evidence.spec ?? session.spec;
  function launch(create: () => Promise<import("@storewhy/contracts").Run>) {
    setDemo(undefined);
    setSource(undefined);
    setPageError("");
    void session.launch(create);
  }
  function send(e: FormEvent) {
    e.preventDefault();
    if (!conversation || !question.trim() || disabled) return;
    launch(() => api.send(conversation.id, question.trim()));
  }
  function patch(text: string, value: ContextPatch) {
    if (conversation && !disabled)
      launch(() => api.send(conversation.id, text, { patch: value }));
  }
  async function showDemo() {
    if (busy) return;
    setDemoBusy(true);
    setPageError("");
    setSource(undefined);
    try {
      setDemo(await api.demo());
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "样例暂不可用");
    } finally {
      setDemoBusy(false);
    }
  }
  return (
    <>
      <header>
        <a className="brand" href="/" aria-label="StoreWhy 首页">
          <span className="brand-mark">w</span>
          <span>
            StoreWhy<small>从变化，找到线索。</small>
          </span>
        </a>
        <div className="header-actions">
          <span className="mode">
            <i className={session.dataMode ? "connected" : ""} />
            {session.dataMode === "zetaris"
              ? "Zetaris 模式 · 公开教学数据"
              : session.dataMode === "fixture"
                ? "自制样例数据"
                : "等待后端连接"}
          </span>
          <button
            disabled={busy}
            onClick={() => {
              setDemo(undefined);
              setSource(undefined);
              setPageError("");
              void session.restore(true);
            }}
          >
            新会话
          </button>
        </div>
      </header>
      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">GROWTH INVESTIGATION / 运营调查</p>
            <h1>
              把变化，<em>问清楚。</em>
            </h1>
            <p>从费用、用户到购买收入，用数据检查解释，带着证据继续追问。</p>
          </div>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              void showDemo();
            }}
          >
            {demoBusy ? "正在读取样例…" : "查看自制样例 ↗"}
          </button>
        </section>
        <Scope spec={spec} />
        <section className="question-card">
          <form onSubmit={send} aria-label="调查问题">
            <label htmlFor="question">
              {run ? "继续这次调查" : "想了解什么变化？"}
            </label>
            <textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={busy}
              maxLength={4000}
              rows={3}
              placeholder="例如：为什么费用增加了，收入却没有同步增长？"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (!disabled && conversation && question.trim())
                    launch(() => api.send(conversation.id, question.trim()));
                }
              }}
            />
            <div className="composer-bottom">
              <span className="caption">
                {demo
                  ? "样例为只读回放，返回调查后可继续提问。"
                  : conversation
                    ? "可直接问问题，也可以沿用上轮条件追问。"
                    : "连接本地后端后开始调查。"}
              </span>
              <button
                className="primary"
                type="submit"
                disabled={disabled || !question.trim()}
              >
                {session.submitting
                  ? "正在提交…"
                  : isRunning(run)
                    ? "调查进行中"
                    : "开始调查 →"}
              </button>
            </div>
          </form>
          <div className="quick-actions">
            <span>快捷追问</span>
            <button
              disabled={disabled || !!demo}
              onClick={() =>
                patch("只看 FaceBoom", { filters: { channels: ["FaceBoom"] } })
              }
            >
              只看 FaceBoom
            </button>
            <button
              disabled={disabled || !!demo}
              onClick={() =>
                patch("清除渠道限制", { filters: { channels: [] } })
              }
            >
              全部渠道
            </button>
            <button
              disabled={disabled || !!demo || spec?.mode !== "cohort"}
              onClick={() => patch("窗口改成7天", { windowDays: 7 })}
            >
              改为 7 天
            </button>
            <button
              disabled={disabled || !!demo || spec?.mode !== "cohort"}
              onClick={() => patch("窗口改成14天", { windowDays: 14 })}
            >
              改为 14 天
            </button>
          </div>
        </section>
        {(session.error || pageError) && (
          <div className="notice error" role="alert">
            {session.error || pageError}
          </div>
        )}
        <div className="session-tools">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setDemo(undefined);
              void session.restore();
            }}
          >
            {session.loading ? "正在读取会话…" : "恢复会话"}
          </button>
          {spec?.mode === "cohort" && (
            <button
              className="text-button"
              disabled={disabled || !!demo}
              onClick={() => {
                void session.remember(spec);
              }}
            >
              记住 {spec.windowDays} 天默认窗口
            </button>
          )}
          <button
            className="text-button"
            disabled={disabled || !!demo}
            onClick={() => {
              if (conversation)
                launch(() =>
                  api.send(conversation.id, "开始新分析：查询新用户收入", {
                    newInvestigation: true,
                    taskKind: "query",
                    patch: { metrics: ["new_users", "revenue"] },
                  }),
                );
            }}
          >
            按默认条件新分析
          </button>
          <span className="caption" role="status">
            {session.notice}
          </span>
        </div>
        {demo && (
          <div className="notice sample">
            <span>
              <strong>自制样例回放</strong> · {demo.notice}
            </span>
            <button onClick={() => setDemo(undefined)}>返回调查</button>
          </div>
        )}
        {!demo && (run || session.submitting) && (
          <section
            className="run-state"
            data-testid="run-state"
            data-run-id={run?.id ?? ""}
            data-status={run?.status ?? "submitting"}
            aria-live="polite"
          >
            <div className="section-heading">
              <div>
                <span className={`badge ${run?.status ?? "queued"}`}>
                  {run ? statuses[run.status] : "提交中"}
                </span>
                <p className="progress-label">
                  {session.submitting
                    ? "正在提交问题"
                    : (run?.progress?.label ?? run?.message ?? "正在读取状态")}
                </p>
              </div>
              {isRunning(run) && (
                <button
                  disabled={run?.cancellationRequested}
                  onClick={() => {
                    void session.cancel();
                  }}
                >
                  {run?.cancellationRequested ? "正在取消…" : "取消调查"}
                </button>
              )}
            </div>
            {run && <p className="caption">本轮问题：{run.question}</p>}
            {session.connection && isRunning(run) && (
              <p className="caption">{session.connection}</p>
            )}
            {run?.message && !run.answer && <p>{run.message}</p>}
            {run?.warnings?.map((w, i) => (
              <p className="notice" key={i}>
                {w}
              </p>
            ))}
            {run && (
              <details>
                <summary>
                  执行记录
                  {run.timing
                    ? ` · ${(run.timing.totalMs / 1000).toFixed(1)} 秒`
                    : ""}
                </summary>
                <ol className="event-list">
                  {run.events.map((e) => (
                    <li key={e.seq}>
                      <span className="meta">
                        {e.seq.toString().padStart(2, "0")}
                      </span>
                      {e.message}
                    </li>
                  ))}
                </ol>
                {run.timing && (
                  <p className="caption">
                    模型调用 {run.timing.modelCalls} 次 · 实际返回 SQL{" "}
                    {run.timing.sqlCount} 条 · 格式修复 {run.timing.repairCalls}{" "}
                    次
                  </p>
                )}
              </details>
            )}
          </section>
        )}
        {report && !demo && run && (
          <p className="caption">
            本轮数据版本：{run.context.datasetVersion} ·{" "}
            {report.charts?.[0]?.source.backend === "fixture"
              ? "自制样例数据"
              : report.charts?.[0]?.source.backend === "zetaris"
                ? "Zetaris 查询结果（教学数据）"
                : "详细来源见分析依据"}
          </p>
        )}
        {report && (
          <Report
            answer={report}
            disabled={disabled || !!demo}
            open={setSource}
            followup={(action) => launch(() => api.followup(action))}
          />
        )}
        {!report && !run && !session.submitting && (
          <section className="empty-state">
            <div>
              <span className="eyebrow">从一个具体问题开始</span>
              <h2>
                先看发生了什么，
                <br />
                再检查可能的解释。
              </h2>
            </div>
            <div className="examples">
              {[
                ["费用与收入", mainQuestion],
                [
                  "购买用户比例",
                  "为什么2019年8月比7月新用户首周购买用户比例下降？只检查用户行为，不分析费用。",
                ],
                ["数据的边界", "为什么2019年7月FaceBoom的广告CTR下降？"],
              ].map(([label, text]) => (
                <button
                  key={label}
                  disabled={busy}
                  onClick={() => setQuestion(text)}
                >
                  <strong>{label} ↗</strong>
                  <span>{text}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        <footer>
          <p>
            Procrastinate Pro+ ·{" "}
            {session.catalog?.dataset.kind === "public_teaching_sample"
              ? "公开教学数据"
              : session.catalog?.dataset.kind === "self_authored_fixture"
                ? "自制测试数据"
                : "等待数据连接"}
            {session.catalog
              ? ` · ${session.catalog.dataset.start} 至 ${session.catalog.dataset.observationEndExclusive}（结束日不含）`
              : ""}
          </p>
          <p>
            费用仅支持渠道与日期。没有点击、曝光、素材、利润数据；观测诊断不等同于因果证明。
          </p>
        </footer>
      </main>
      {source && (
        <EvidenceDialog
          key={`${source.id}-${source.rowIndex ?? "all"}-${source.metric ?? ""}`}
          request={source}
          local={demo?.evidence}
          close={() => setSource(undefined)}
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
