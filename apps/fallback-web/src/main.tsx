import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import type {
  Answer,
  AnalysisSpec,
  ContextPatch,
  DemoReplay,
  FollowupAction,
  Run,
  RunStatus,
} from "@storewhy/contracts";
import { api, useInvestigation, isRunning } from "./session";
import { EvidenceChart, type EvidenceRequest } from "./charts";
import { EvidenceDialog } from "./evidence";
import "./style.css";
const mainQuestion =
  "Why did spend rise in July 2019 while 14-day new-user revenue stayed flat?";
const statuses: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Investigating",
  completed: "Completed",
  limited: "Evidence gap",
  needs_clarification: "Needs input",
  unsupported: "Unsupported",
  no_data: "No data",
  failed: "Failed",
  cancelled: "Cancelled",
};
function Scope({ spec }: { spec?: AnalysisSpec }) {
  return (
    <section
      id="scope"
      className="scope glass-panel"
      aria-label="Investigation scope"
      data-testid="scope"
    >
      {!spec ? (
        <p>Connect to load scope.</p>
      ) : (
        <>
          <div className="scope-items">
            <span>
              <b>PERIOD</b>
              {spec.periods.map((p) => p.label).join(" → ")}
            </span>
            <span>
              <b>WINDOW</b>
              {spec.mode === "cohort"
                ? `${spec.windowDays}-day cohort`
                : `Calendar${spec.timeGrain ? ` · ${({ day: "Daily", week: "Weekly", month: "Monthly" } as const)[spec.timeGrain]}` : ""}`}
            </span>
            <span>
              <b>AUDIENCE</b>
              {spec.audience === "paid" ? "Paid users" : "All users"}
            </span>
            <span>
              <b>CHANNEL</b>
              {spec.filters.channels.join(", ") || "All channels"}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

const metricNames: Record<string, string> = {
  spend: "Acquisition spend",
  new_users: "New users",
  revenue: "14-day revenue",
  purchasers: "Purchasers",
  payers: "Purchasers",
  payer_rate: "Payer rate",
  revenue_to_spend: "Revenue / spend",
  cost_per_new_user: "Cost / new user",
};

function MetricStrip({ answer }: { answer: Answer }) {
  const visible = answer.facts.slice(0, 4);
  if (!visible.length) return null;
  return (
    <section className="metric-strip" aria-label="Verified metrics">
      {visible.map((fact, index) => (
        <article
          className="metric-card glass-panel"
          key={fact.id}
          style={{ "--delay": `${index * 70}ms` } as CSSProperties}
        >
          <span className="metric-label">
            {metricNames[fact.metric] ?? fact.metric.replaceAll("_", " ")}
          </span>
          <strong>
            {fact.value === null
              ? "—"
              : new Intl.NumberFormat("en-US", {
                  maximumFractionDigits: 2,
                }).format(fact.value)}
          </strong>
          <span className="metric-context">
            {fact.label.split("/")[0]?.trim()}
          </span>
        </article>
      ))}
    </section>
  );
}

function SignalMap() {
  return (
    <div className="signal-map" aria-hidden="true">
      <div className="signal-glow signal-glow-one" />
      <div className="signal-glow signal-glow-two" />
      <svg viewBox="0 0 520 360" role="presentation">
        <path
          className="signal-path path-one"
          d="M94 258 C155 176 185 180 258 181 S373 184 429 92"
        />
        <path
          className="signal-path path-two"
          d="M91 258 C171 294 270 298 429 92"
        />
        <circle className="signal-node node-data" cx="94" cy="258" r="43" />
        <circle className="signal-node node-agent" cx="258" cy="181" r="53" />
        <circle className="signal-node node-proof" cx="429" cy="92" r="43" />
        <circle
          className="signal-particle particle-one"
          cx="94"
          cy="258"
          r="5"
        />
        <circle
          className="signal-particle particle-two"
          cx="94"
          cy="258"
          r="4"
        />
      </svg>
      <span className="signal-label signal-data">Data</span>
      <span className="signal-label signal-agent">Investigate</span>
      <span className="signal-label signal-proof">Evidence</span>
    </div>
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
    <div className="report" id="evidence" data-testid="report">
      <MetricStrip answer={answer} />
      <section className="conclusion glass-panel">
        <h2>{answer.conclusion?.text ?? answer.summary}</h2>
      </section>
      {(answer.keyEvidence ?? answer.findings).length > 0 && (
        <section>
          <div className="section-heading">
            <h3>Key evidence</h3>
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
                        aria-label={`View evidence · ${f.label}`}
                        onClick={() =>
                          open({
                            id: f.evidenceId,
                            rowIndex: f.rowIndex,
                            metric: f.metric,
                          })
                        }
                      >
                        Evidence ↗
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
      {(answer.chartNotes ?? []).length > 0 && (
        <details className="report-notes">
          <summary>Analysis notes</summary>
          {(answer.chartNotes ?? []).map((note, i) => (
            <p className="caption" key={i}>
              {note}
            </p>
          ))}
        </details>
      )}
      {(answer.explanations ?? []).length > 0 && (
        <section>
          <h3>Explanations checked</h3>
          <div className="explanations">
            {answer.explanations!.map((e) => (
              <article key={e.id}>
                <span className={`badge ${e.status}`}>
                  {
                    (
                      {
                        supported: "Supported",
                        contradicted: "Contradicted",
                        missing_data: "Missing data",
                        not_checked: "Not checked",
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
                        View evidence
                      </button>
                    ))}
                    {e.coverageRefs.map((c) => (
                      <button
                        key={`${c.evidenceId}-${c.period}`}
                        className="text-button"
                        onClick={() => open({ id: c.evidenceId })}
                      >
                        View {c.period} coverage
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
        <details className="limitations">
          <summary>Limitations · {answer.limitations.length}</summary>
          <ul>
            {answer.limitations.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      {(answer.followups ?? []).length > 0 ? (
        <section>
          <h3>Continue the investigation</h3>
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
            <h3>What to check next</h3>
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

const investigationPhases = [
  { id: "understanding", label: "Frame" },
  { id: "querying", label: "Query" },
  { id: "explaining", label: "Explain" },
  { id: "reviewing", label: "Review" },
  { id: "presenting", label: "Present" },
];

function ProgressRail({
  phase,
  complete,
}: {
  phase?: string;
  complete?: boolean;
}) {
  const activeIndex = complete
    ? investigationPhases.length
    : Math.max(
        0,
        investigationPhases.findIndex((item) => item.id === phase),
      );
  return (
    <div className="progress-rail" aria-label="Investigation progress">
      {investigationPhases.map((item, index) => {
        const state =
          index < activeIndex
            ? "done"
            : index === activeIndex
              ? "active"
              : "pending";
        return (
          <div className={`progress-step ${state}`} key={item.id}>
            <span>
              <i />
              <span className="sr-only">{item.label}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

const starterThreads = [
  {
    id: "purchasers",
    title: "Purchaser rate",
    prompt:
      "Why did the first-week purchaser rate of new users fall in August 2019 versus July? Focus on user behaviour, not spend.",
  },
  {
    id: "boundaries",
    title: "Data boundaries",
    prompt: "Why did FaceBoom ad CTR decline in July 2019?",
  },
] as const;

type ChatWorkspaceProps = {
  run?: Run;
  report?: Answer;
  spec?: AnalysisSpec;
  question: string;
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  disabled: boolean;
  submitting: boolean;
  connection?: string;
  notice?: string;
  error?: string;
  modeLabel: string;
  open: (request: EvidenceRequest) => void;
  followup: (action: FollowupAction) => void;
  patch: (text: string, value: ContextPatch) => void;
  send: (event: FormEvent) => void;
  cancel: () => void;
  remember: () => void;
  startDefaults: () => void;
  restore: () => void;
  sample: () => void;
  back: () => void;
  fresh: () => void;
  useStarter: (prompt: string) => void;
};

function ChatWorkspace({
  run,
  report,
  spec,
  question,
  input,
  setInput,
  busy,
  disabled,
  submitting,
  connection,
  notice,
  error,
  modeLabel,
  open,
  followup,
  patch,
  send,
  cancel,
  remember,
  startDefaults,
  restore,
  sample,
  back,
  fresh,
  useStarter,
}: ChatWorkspaceProps) {
  const currentQuestion = run?.question ?? question;
  const threads = [
    {
      id: "current",
      title: currentQuestion,
      prompt: currentQuestion,
      current: true,
    },
    ...starterThreads.map((thread) => ({ ...thread, current: false })),
  ];
  const [activeThread, setActiveThread] = useState(0);
  const [slideDirection, setSlideDirection] = useState<"left" | "right">(
    "right",
  );
  const [slideKey, setSlideKey] = useState(0);
  const touchStart = useRef<number | undefined>(undefined);

  useEffect(() => {
    setActiveThread(0);
  }, [run?.id]);

  function goToThread(index: number) {
    if (index < 0 || index >= threads.length || index === activeThread) return;
    setSlideDirection(index > activeThread ? "left" : "right");
    setActiveThread(index);
    setSlideKey((value) => value + 1);
  }

  const selected = threads[activeThread] ?? threads[0];

  return (
    <div className="chat-shell">
      <aside className="chat-sidebar glass-panel">
        <div className="chat-sidebar-head">
          <button className="chat-brand" onClick={back} aria-label="Back home">
            <span className="brand-mark">W</span>
            <span>StoreWhy</span>
          </button>
          <button
            className="chat-new"
            onClick={fresh}
            disabled={busy}
            aria-label="New investigation"
          >
            <span aria-hidden="true">＋</span> New
          </button>
        </div>

        <div className="thread-list-wrap">
          <nav className="thread-list" aria-label="Investigation conversations">
            {threads.map((thread, index) => (
              <button
                key={thread.id}
                className={index === activeThread ? "active" : ""}
                onClick={() => goToThread(index)}
                aria-current={index === activeThread ? "page" : undefined}
              >
                <strong>{thread.title}</strong>
              </button>
            ))}
          </nav>
        </div>

        <div className="chat-sidebar-tools">
          <div className="chat-mode">
            <i className="connected" />
            <span>{modeLabel}</span>
          </div>
          <div className="chat-tool-row">
            <button
              aria-label="Restore session"
              disabled={busy}
              onClick={restore}
            >
              Restore
            </button>
            <button
              aria-label="Explore a sample investigation"
              disabled={busy}
              onClick={sample}
            >
              Sample
            </button>
          </div>
        </div>
      </aside>

      <section className="chat-main glass-panel">
        <header className="chat-topbar">
          <div>
            <button className="chat-back" onClick={back} aria-label="Back home">
              ←
            </button>
          </div>
          <div className="chat-pager">
            <button
              aria-label="Previous conversation"
              disabled={activeThread === 0}
              onClick={() => goToThread(activeThread - 1)}
            >
              ←
            </button>
            <button
              aria-label="Next conversation"
              disabled={activeThread === threads.length - 1}
              onClick={() => goToThread(activeThread + 1)}
            >
              →
            </button>
          </div>
        </header>

        <div className="chat-thread-strip" aria-label="Conversation carousel">
          {threads.map((thread, index) => (
            <button
              key={thread.id}
              className={index === activeThread ? "active" : ""}
              onClick={() => goToThread(index)}
            >
              {thread.current ? "Current" : thread.title}
            </button>
          ))}
        </div>

        <div
          className="chat-carousel"
          onTouchStart={(event) => {
            touchStart.current = event.changedTouches[0]?.clientX;
          }}
          onTouchEnd={(event) => {
            if (touchStart.current === undefined) return;
            const distance =
              (event.changedTouches[0]?.clientX ?? touchStart.current) -
              touchStart.current;
            touchStart.current = undefined;
            if (Math.abs(distance) < 55) return;
            goToThread(activeThread + (distance < 0 ? 1 : -1));
          }}
        >
          <article
            key={`${selected.id}-${slideKey}`}
            className={`conversation-slide slide-${slideDirection}`}
          >
            {selected.current ? (
              <div className="conversation-flow">
                <div className="chat-message user-message">
                  <div className="message-bubble">{currentQuestion}</div>
                </div>

                <div className="chat-message assistant-message">
                  <div className="assistant-avatar" aria-hidden="true">
                    W
                  </div>
                  <div className="assistant-body">
                    {error && (
                      <div className="notice error" role="alert">
                        {error}
                      </div>
                    )}
                    {(run || submitting) && (
                      <section
                        className="run-state chat-run-state"
                        data-testid="run-state"
                        data-run-id={run?.id ?? ""}
                        data-status={run?.status ?? "submitting"}
                        aria-live="polite"
                      >
                        <div className="section-heading">
                          <div>
                            <span
                              className={`badge ${run?.status ?? "queued"}`}
                            >
                              {run ? statuses[run.status] : "Submitting"}
                            </span>
                            {(submitting || isRunning(run)) && (
                              <p className="progress-label">
                                {submitting
                                  ? "Sending your question"
                                  : (run?.progress?.label ??
                                    "Reading investigation status")}
                              </p>
                            )}
                          </div>
                          {isRunning(run) && (
                            <button
                              disabled={run?.cancellationRequested}
                              onClick={cancel}
                            >
                              {run?.cancellationRequested
                                ? "Cancelling…"
                                : "Cancel investigation"}
                            </button>
                          )}
                        </div>
                        <ProgressRail
                          phase={run?.progress?.phase}
                          complete={!!run && !isRunning(run)}
                        />
                        {connection && isRunning(run) && (
                          <p className="caption">{connection}</p>
                        )}
                        {run?.message && !run.answer && <p>{run.message}</p>}
                        {run?.warnings?.map((warning, index) => (
                          <p className="notice" key={index}>
                            {warning}
                          </p>
                        ))}
                        {run && (
                          <details>
                            <summary>
                              Execution log
                              {run.timing
                                ? ` · ${(run.timing.totalMs / 1000).toFixed(1)} sec`
                                : ""}
                            </summary>
                            <ol className="event-list">
                              {run.events.map((event) => (
                                <li key={event.seq}>
                                  <span className="meta">
                                    {event.seq.toString().padStart(2, "0")}
                                  </span>
                                  {event.message}
                                </li>
                              ))}
                            </ol>
                          </details>
                        )}
                      </section>
                    )}
                    {report && run && (
                      <p className="caption dataset-caption">
                        ✓ {run.context.datasetVersion}
                      </p>
                    )}
                    {report && (
                      <Report
                        answer={report}
                        disabled={disabled}
                        open={open}
                        followup={followup}
                      />
                    )}
                    {notice && (
                      <p className="chat-notice" role="status">
                        {notice}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="starter-thread glass-panel">
                <h2>{selected.title}</h2>
                <p>{selected.prompt}</p>
                <button onClick={() => useStarter(selected.prompt)}>
                  Use this question <span aria-hidden="true">↗</span>
                </button>
              </div>
            )}
          </article>
        </div>

        {selected.current && (
          <div className="chat-composer-wrap">
            <div
              className="chat-scope-tools"
              aria-label="Investigation filters"
            >
              <button
                disabled={disabled}
                onClick={() =>
                  patch("Show FaceBoom only", {
                    filters: { channels: ["FaceBoom"] },
                  })
                }
              >
                FaceBoom only
              </button>
              <button
                disabled={disabled}
                onClick={() =>
                  patch("Clear the channel filter", {
                    filters: { channels: [] },
                  })
                }
              >
                All channels
              </button>
              <button
                disabled={disabled || spec?.mode !== "cohort"}
                onClick={() => patch("Use a 7-day window", { windowDays: 7 })}
              >
                7-day window
              </button>
              <button
                disabled={disabled || spec?.mode !== "cohort"}
                onClick={() => patch("Use a 14-day window", { windowDays: 14 })}
              >
                14-day window
              </button>
              {spec?.mode === "cohort" && (
                <button
                  aria-label={`Remember ${spec.windowDays}-day window`}
                  disabled={disabled}
                  onClick={remember}
                >
                  Remember {spec.windowDays}d
                </button>
              )}
              <button
                aria-label="Start from saved defaults"
                disabled={disabled}
                onClick={startDefaults}
              >
                Start fresh
              </button>
            </div>
            <form className="chat-composer" onSubmit={send}>
              <textarea
                aria-label="Continue this investigation"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={busy}
                rows={1}
                maxLength={4000}
                placeholder="Ask a follow-up…"
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button
                className="primary"
                type="submit"
                aria-label="Investigate"
                disabled={disabled || !input.trim()}
              >
                <span aria-hidden="true">↑</span>
              </button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}

function App() {
  const session = useInvestigation();
  const [question, setQuestion] = useState(mainQuestion),
    [demo, setDemo] = useState<DemoReplay>();
  const [view, setView] = useState<"home" | "chat">("home");
  const [chatInput, setChatInput] = useState("");
  const [pendingChatInput, setPendingChatInput] = useState("");
  const [demoBusy, setDemoBusy] = useState(false),
    [pageError, setPageError] = useState("");
  const [source, setSource] = useState<EvidenceRequest>();
  const { run, conversation } = session;
  const busy = session.busy || demoBusy;
  const disabled = busy || session.uncertain || !conversation || !!demo;
  const report = demo?.answer ?? run?.answer;
  const spec = demo?.evidence.spec ?? session.spec;

  function changeView(next: "home" | "chat") {
    if (next === view) return;
    const documentWithTransitions = document as Document & {
      startViewTransition?: (update: () => void) => unknown;
    };
    if (documentWithTransitions.startViewTransition) {
      documentWithTransitions.startViewTransition(() => setView(next));
    } else {
      setView(next);
    }
  }

  useEffect(() => {
    if (run?.id && !demo) setView("chat");
  }, [run?.id, demo]);

  useEffect(() => {
    if (run?.id) setPendingChatInput("");
  }, [run?.id]);

  useEffect(() => {
    if (session.uncertain && pendingChatInput) {
      setChatInput(pendingChatInput);
    }
  }, [session.uncertain, pendingChatInput]);

  useEffect(() => {
    document.body.classList.toggle("chat-open", view === "chat" && !demo);
    return () => document.body.classList.remove("chat-open");
  }, [view, demo]);

  function launch(create: () => Promise<import("@storewhy/contracts").Run>) {
    setDemo(undefined);
    setSource(undefined);
    setPageError("");
    changeView("chat");
    void session.launch(create);
  }
  function send(e: FormEvent) {
    e.preventDefault();
    if (!conversation || !question.trim() || disabled) return;
    launch(() => api.send(conversation.id, question.trim()));
  }
  function sendChat(e: FormEvent) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!conversation || !text || disabled) return;
    setPendingChatInput(text);
    setChatInput("");
    launch(() => api.send(conversation.id, text));
  }
  function patch(text: string, value: ContextPatch) {
    if (conversation && !disabled)
      launch(() => api.send(conversation.id, text, { patch: value }));
  }
  async function showDemo() {
    if (busy) return;
    changeView("home");
    setDemoBusy(true);
    setPageError("");
    setSource(undefined);
    try {
      setDemo(await api.demo());
    } catch (e) {
      setPageError(
        e instanceof Error
          ? e.message
          : "The sample is temporarily unavailable.",
      );
    } finally {
      setDemoBusy(false);
    }
  }

  function newInvestigation(prompt = mainQuestion) {
    setDemo(undefined);
    setSource(undefined);
    setPageError("");
    setQuestion(prompt);
    setChatInput("");
    setPendingChatInput("");
    changeView("home");
    void session.restore(true);
  }

  const chatMode = view === "chat" && !demo;
  const modeLabel =
    session.dataMode === "zetaris"
      ? "Live data"
      : session.dataMode === "fixture"
        ? "Sample mode"
        : "Connecting";

  return (
    <>
      <div className="ambient" aria-hidden="true">
        <span className="orb orb-one" />
        <span className="orb orb-two" />
        <span className="orb orb-three" />
        <span className="noise" />
      </div>
      {chatMode ? (
        <ChatWorkspace
          run={run}
          report={run?.answer}
          spec={session.spec}
          question={question}
          input={chatInput}
          setInput={setChatInput}
          busy={busy}
          disabled={disabled}
          submitting={session.submitting}
          connection={session.connection}
          notice={session.notice}
          error={session.error || pageError}
          modeLabel={modeLabel}
          open={setSource}
          followup={(action) => launch(() => api.followup(action))}
          patch={patch}
          send={sendChat}
          cancel={() => {
            void session.cancel();
          }}
          remember={() => {
            if (session.spec) void session.remember(session.spec);
          }}
          startDefaults={() => {
            if (conversation)
              launch(() =>
                api.send(
                  conversation.id,
                  "Start a new analysis of new-user revenue",
                  {
                    newInvestigation: true,
                    taskKind: "query",
                    patch: { metrics: ["new_users", "revenue"] },
                  },
                ),
              );
          }}
          restore={() => {
            setDemo(undefined);
            void session.restore();
          }}
          sample={() => {
            void showDemo();
          }}
          back={() => changeView("home")}
          fresh={() => newInvestigation()}
          useStarter={(prompt) => newInvestigation(prompt)}
        />
      ) : (
        <>
          <header className="glass-panel">
            <a className="brand" href="/" aria-label="StoreWhy home">
              <span className="brand-mark">W</span>
              <span>StoreWhy</span>
            </a>
            <nav className="rail-nav" aria-label="Primary navigation">
              <a className="active" href="#ask">
                <span aria-hidden="true">✦</span> Ask
              </a>
              <a href="#scope">
                <span aria-hidden="true">◎</span> Scope
              </a>
              <a href="#evidence">
                <span aria-hidden="true">⌁</span> Evidence
              </a>
            </nav>
            <div className="header-actions">
              <span className="mode">
                <i className={session.dataMode ? "connected" : ""} />
                {modeLabel}
              </span>
              <button
                className="header-button"
                aria-label="New investigation"
                disabled={busy}
                onClick={() => newInvestigation()}
              >
                New <span aria-hidden="true">＋</span>
              </button>
            </div>
          </header>
          <main>
            <section
              className={`intro glass-panel ${report || run ? "intro-compact" : ""}`}
            >
              <div className="intro-copy">
                <h1>
                  Ask what changed.
                  <br />
                  <em>See why.</em>
                </h1>
                <button
                  className="sample-link"
                  aria-label="Explore a sample investigation"
                  disabled={busy}
                  onClick={() => {
                    void showDemo();
                  }}
                >
                  {demoBusy ? "Loading…" : "View sample"}
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
              <SignalMap />
            </section>
            <Scope spec={spec} />
            <section id="ask" className="question-card glass-panel">
              <form onSubmit={send} aria-label="Investigation question">
                <textarea
                  id="question"
                  aria-label={
                    run
                      ? "Continue this investigation"
                      : "What changed—and why?"
                  }
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  disabled={busy}
                  maxLength={4000}
                  rows={3}
                  placeholder="What changed—and why?"
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      if (!disabled && conversation && question.trim())
                        launch(() =>
                          api.send(conversation.id, question.trim()),
                        );
                    }
                  }}
                />
                <div className="composer-bottom">
                  {!conversation && (
                    <span className="caption">Connect to begin.</span>
                  )}
                  <button
                    className="primary"
                    type="submit"
                    disabled={disabled || !question.trim()}
                  >
                    {session.submitting
                      ? "Submitting…"
                      : isRunning(run)
                        ? "Investigating"
                        : "Investigate"}
                    <span aria-hidden="true"> ↗</span>
                  </button>
                </div>
              </form>
              <div className="quick-actions">
                <button
                  disabled={disabled || !!demo}
                  onClick={() =>
                    patch("Show FaceBoom only", {
                      filters: { channels: ["FaceBoom"] },
                    })
                  }
                >
                  FaceBoom only
                </button>
                <button
                  disabled={disabled || !!demo}
                  onClick={() =>
                    patch("Clear the channel filter", {
                      filters: { channels: [] },
                    })
                  }
                >
                  All channels
                </button>
                <button
                  disabled={disabled || !!demo || spec?.mode !== "cohort"}
                  onClick={() => patch("Use a 7-day window", { windowDays: 7 })}
                >
                  7-day window
                </button>
                <button
                  disabled={disabled || !!demo || spec?.mode !== "cohort"}
                  onClick={() =>
                    patch("Use a 14-day window", { windowDays: 14 })
                  }
                >
                  14-day window
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
                aria-label="Restore session"
                disabled={busy}
                onClick={() => {
                  setDemo(undefined);
                  void session.restore();
                }}
              >
                {session.loading ? "Restoring…" : "Restore"}
              </button>
              {spec?.mode === "cohort" && (
                <button
                  className="text-button"
                  aria-label={`Remember ${spec.windowDays}-day window`}
                  disabled={disabled || !!demo}
                  onClick={() => {
                    void session.remember(spec);
                  }}
                >
                  Remember {spec.windowDays}d
                </button>
              )}
              <button
                className="text-button"
                aria-label="Start from saved defaults"
                disabled={disabled || !!demo}
                onClick={() => {
                  if (conversation)
                    launch(() =>
                      api.send(
                        conversation.id,
                        "Start a new analysis of new-user revenue",
                        {
                          newInvestigation: true,
                          taskKind: "query",
                          patch: { metrics: ["new_users", "revenue"] },
                        },
                      ),
                    );
                }}
              >
                Start fresh
              </button>
              <span className="caption" role="status">
                {session.notice}
              </span>
            </div>
            {demo && (
              <div className="notice sample">
                <span>
                  <strong>Sample</strong>
                </span>
                <button
                  aria-label="Return to investigation"
                  onClick={() => {
                    setDemo(undefined);
                    if (run) changeView("chat");
                  }}
                >
                  Back
                </button>
              </div>
            )}
            {!demo && (run || session.submitting) && (
              <section
                className="run-state glass-panel"
                data-testid="run-state"
                data-run-id={run?.id ?? ""}
                data-status={run?.status ?? "submitting"}
                aria-live="polite"
              >
                <div className="section-heading">
                  <div>
                    <span className={`badge ${run?.status ?? "queued"}`}>
                      {run ? statuses[run.status] : "Submitting"}
                    </span>
                    {(session.submitting || isRunning(run)) && (
                      <p className="progress-label">
                        {session.submitting
                          ? "Sending your question"
                          : (run?.progress?.label ??
                            "Reading investigation status")}
                      </p>
                    )}
                  </div>
                  {isRunning(run) && (
                    <button
                      disabled={run?.cancellationRequested}
                      onClick={() => {
                        void session.cancel();
                      }}
                    >
                      {run?.cancellationRequested
                        ? "Cancelling…"
                        : "Cancel investigation"}
                    </button>
                  )}
                </div>
                <ProgressRail
                  phase={run?.progress?.phase}
                  complete={!!run && !isRunning(run)}
                />
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
                      Execution log
                      {run.timing
                        ? ` · ${(run.timing.totalMs / 1000).toFixed(1)} sec`
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
                        {run.timing.modelCalls} model calls ·{" "}
                        {run.timing.sqlCount} SQL queries ·{" "}
                        {run.timing.repairCalls} format repairs
                      </p>
                    )}
                  </details>
                )}
              </section>
            )}
            {report && !demo && run && (
              <p className="caption dataset-caption">
                ✓ {run.context.datasetVersion}
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
              <section className="empty-state glass-panel">
                <div className="examples">
                  {[
                    ["Spend vs. revenue", mainQuestion],
                    [
                      "Purchaser rate",
                      "Why did the first-week purchaser rate of new users fall in August 2019 versus July? Focus on user behaviour, not spend.",
                    ],
                    [
                      "Data boundaries",
                      "Why did FaceBoom ad CTR decline in July 2019?",
                    ],
                  ].map(([label, text]) => (
                    <button
                      key={label}
                      disabled={busy}
                      onClick={() => setQuestion(text)}
                    >
                      <strong>{label} ↗</strong>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <footer>
              <p>
                {session.catalog?.dataset.kind === "public_teaching_sample"
                  ? "Teaching data"
                  : session.catalog?.dataset.kind === "self_authored_fixture"
                    ? "Sample data"
                    : "Connecting"}
                {" · Observational, not causal"}
              </p>
            </footer>
          </main>
        </>
      )}
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
