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
  "Why did recorded spend increase in July 2019 versus June, while new users’ revenue within 14 days of first visit failed to keep pace?";
const statuses: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Investigating",
  completed: "Complete",
  limited: "Some explanations need evidence",
  needs_clarification: "Clarification needed",
  unsupported: "Unsupported by this data",
  no_data: "No data in this scope",
  failed: "Investigation failed",
  cancelled: "Cancelled",
};
function Scope({ spec }: { spec?: AnalysisSpec }) {
  return (
    <section className="scope" aria-label="Current scope" data-testid="scope">
      <p className="eyebrow">Current scope</p>
      {!spec ? (
        <p>The actual scope will appear once connected</p>
      ) : (
        <>
          <div className="scope-items">
            <span>
              <b>Periods</b>
              {spec.periods.map((p) => p.label).join(" → ")}
            </span>
            <span>
              <b>Time basis</b>
              {spec.mode === "cohort"
                ? `First ${spec.windowDays} days after first visit`
                : `Calendar period${spec.timeGrain ? ` · ${({ day: "Daily", week: "Weekly", month: "Monthly" } as const)[spec.timeGrain]}` : ""}`}
            </span>
            <span>
              <b>Audience</b>
              {spec.audience === "paid"
                ? "Paid-channel users"
                : "All users (including organic)"}
            </span>
            <span>
              <b>Channels</b>
              {spec.filters.channels.join(", ") || "All channels"}
            </span>
          </div>
          <p className="caption">
            {spec.periods.map((p) => `${p.start} to ${p.end}`).join("; ")}; end
            dates excluded. Devices: {spec.filters.devices.join(", ") || "All"}{" "}
            · Countries: {spec.filters.regions.join(", ") || "All"}
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
        <p className="eyebrow">Conclusion</p>
        <h2>{answer.conclusion?.text ?? answer.summary}</h2>
      </section>
      {(answer.keyEvidence ?? answer.findings).length > 0 && (
        <section>
          <div className="section-heading">
            <h3>Key evidence</h3>
            <span className="meta">Figures from executed queries</span>
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
                        View source · {f.label}
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
          <h3>Explanations checked</h3>
          <p className="caption">
            Support and contradiction describe observations; they do not
            establish causality.
          </p>
          <div className="explanations">
            {answer.explanations!.map((e) => (
              <article key={e.id}>
                <span className={`badge ${e.status}`}>
                  {
                    (
                      {
                        supported: "Supported by observations",
                        contradicted: "Contradicted by observations",
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
        <section className="limitations">
          <h3>Limitations</h3>
          <ul>
            {answer.limitations.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      {(answer.followups ?? []).length > 0 ? (
        <section>
          <h3>Follow up</h3>
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
      setPageError(
        e instanceof Error ? e.message : "The sample is unavailable",
      );
    } finally {
      setDemoBusy(false);
    }
  }
  return (
    <>
      <header>
        <a className="brand" href="/" aria-label="StoreWhy home">
          <span className="brand-mark">w</span>
          <span>
            StoreWhy<small>From changes to evidence.</small>
          </span>
        </a>
        <div className="header-actions">
          <span className="mode">
            <i className={session.dataMode ? "connected" : ""} />
            {session.dataMode === "zetaris"
              ? "Zetaris · Public teaching data"
              : session.dataMode === "fixture"
                ? "Self-authored sample data"
                : "Connecting to backend"}
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
            New session
          </button>
        </div>
      </header>
      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">GROWTH INVESTIGATION</p>
            <h1>
              Understand <em>the change.</em>
            </h1>
            <p>
              From spend and users to purchase revenue. Check explanations, then
              follow the evidence.
            </p>
          </div>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              void showDemo();
            }}
          >
            {demoBusy ? "Loading sample…" : "View sample replay ↗"}
          </button>
        </section>
        <Scope spec={spec} />
        <section className="question-card">
          <form onSubmit={send} aria-label="Investigation question">
            <label htmlFor="question">
              {run ? "Continue this investigation" : "What changed?"}
            </label>
            <textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={busy}
              maxLength={4000}
              rows={3}
              placeholder="For example: Why did spend increase without matching revenue growth?"
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
                  ? "This sample is read-only. Return to the investigation to ask a question."
                  : conversation
                    ? "Ask a question or follow up using the current scope."
                    : "Connect to the backend to start investigating."}
              </span>
              <button
                className="primary"
                type="submit"
                disabled={disabled || !question.trim()}
              >
                {session.submitting
                  ? "Submitting…"
                  : isRunning(run)
                    ? "Investigation in progress"
                    : "Investigate →"}
              </button>
            </div>
          </form>
          <div className="quick-actions">
            <span>Quick follow-ups</span>
            <button
              disabled={disabled || !!demo}
              onClick={() =>
                patch("Focus on FaceBoom", {
                  filters: { channels: ["FaceBoom"] },
                })
              }
            >
              Focus on FaceBoom
            </button>
            <button
              disabled={disabled || !!demo}
              onClick={() =>
                patch("Clear the channel filter", { filters: { channels: [] } })
              }
            >
              All channels
            </button>
            <button
              disabled={disabled || !!demo || spec?.mode !== "cohort"}
              onClick={() =>
                patch("Change the window to 7 days", { windowDays: 7 })
              }
            >
              Use 7 days
            </button>
            <button
              disabled={disabled || !!demo || spec?.mode !== "cohort"}
              onClick={() =>
                patch("Change the window to 14 days", { windowDays: 14 })
              }
            >
              Use 14 days
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
            {session.loading ? "Loading session…" : "Resume session"}
          </button>
          {spec?.mode === "cohort" && (
            <button
              className="text-button"
              disabled={disabled || !!demo}
              onClick={() => {
                void session.remember(spec);
              }}
            >
              Save {spec.windowDays}-day default
            </button>
          )}
          <button
            className="text-button"
            disabled={disabled || !!demo}
            onClick={() => {
              if (conversation)
                launch(() =>
                  api.send(
                    conversation.id,
                    "Start a new analysis: query new-user revenue",
                    {
                      newInvestigation: true,
                      taskKind: "query",
                      patch: { metrics: ["new_users", "revenue"] },
                    },
                  ),
                );
            }}
          >
            New analysis with saved defaults
          </button>
          <span className="caption" role="status">
            {session.notice}
          </span>
        </div>
        {demo && (
          <div className="notice sample">
            <span>
              <strong>Self-authored sample replay</strong> · {demo.notice}
            </span>
            <button onClick={() => setDemo(undefined)}>
              Return to investigation
            </button>
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
                  {run ? statuses[run.status] : "Submitting"}
                </span>
                <p className="progress-label">
                  {session.submitting
                    ? "Submitting your question"
                    : (run?.progress?.label ??
                      run?.message ??
                      "Reading investigation status")}
                </p>
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
            {run && <p className="caption">Question: {run.question}</p>}
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
                    ? ` · ${(run.timing.totalMs / 1000).toFixed(1)} seconds`
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
                    Model calls: {run.timing.modelCalls} · Returned SQL queries:{" "}
                    {run.timing.sqlCount} · Format repairs:{" "}
                    {run.timing.repairCalls}{" "}
                  </p>
                )}
              </details>
            )}
          </section>
        )}
        {report && !demo && run && (
          <p className="caption">
            Dataset version: {run.context.datasetVersion} ·{" "}
            {report.charts?.[0]?.source.backend === "fixture"
              ? "Self-authored sample data"
              : report.charts?.[0]?.source.backend === "zetaris"
                ? "Zetaris query results (teaching data)"
                : "See evidence for source details"}
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
              <span className="eyebrow">START WITH A SPECIFIC QUESTION</span>
              <h2>
                See what changed.
                <br />
                Then check why.
              </h2>
            </div>
            <div className="examples">
              {[
                ["Spend and revenue", mainQuestion],
                [
                  "Purchaser rate",
                  "Why did the first-week purchaser rate for new users decrease in August 2019 versus July? Check user behavior only, without spend analysis.",
                ],
                [
                  "Data boundaries",
                  "Why did FaceBoom ad CTR fall in July 2019?",
                ],
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
              ? "Public teaching data"
              : session.catalog?.dataset.kind === "self_authored_fixture"
                ? "Self-authored test data"
                : "Connecting to data"}
            {session.catalog
              ? ` · ${session.catalog.dataset.start} to ${session.catalog.dataset.observationEndExclusive} (end exclusive)`
              : ""}
          </p>
          <p>
            Spend is available by channel and date only. Clicks, impressions,
            creatives and profit are unavailable. Observational diagnosis does
            not prove causality.
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
