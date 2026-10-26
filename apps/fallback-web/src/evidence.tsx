import { useEffect, useRef, useState } from "react";
import type { Evidence } from "@storewhy/contracts";
import { api } from "./session";
import type { EvidenceRequest } from "./charts";
export function EvidenceDialog({
  request,
  local,
  close,
}: {
  request: EvidenceRequest;
  local?: Evidence;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [evidence, setEvidence] = useState<Evidence>(),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  useEffect(() => {
    let disposed = false;
    setError("");
    setEvidence(undefined);
    const pending =
      local?.id === request.id
        ? Promise.resolve(local)
        : api.evidence(request.id);
    pending
      .then((value) => {
        if (!disposed) setEvidence(value);
      })
      .catch((e: unknown) => {
        if (!disposed)
          setError(e instanceof Error ? e.message : "Could not load evidence");
      });
    return () => {
      disposed = true;
    };
  }, [request.id, local, retry]);
  return (
    <dialog
      ref={dialog}
      onCancel={close}
      className="evidence-dialog"
      aria-labelledby="evidence-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">EVIDENCE</p>
          <h2 id="evidence-title">Inspect evidence</h2>
        </div>
        <button onClick={close} autoFocus>
          Close
        </button>
      </div>
      {error ? (
        <div role="alert" className="notice error">
          {error}
          <button onClick={() => setRetry((v) => v + 1)}>Retry</button>
        </div>
      ) : !evidence ? (
        <p role="status">Loading evidence…</p>
      ) : (
        <>
          <p className="caption">
            {evidence.backend === "zetaris"
              ? "Zetaris query results"
              : "Self-authored sample data"}{" "}
            · {evidence.datasetVersion}
          </p>
          <p className="mono wrap">{evidence.id}</p>
          {request.rowIndex !== undefined && (
            <section className="source-cell">
              <h3>Referenced value</h3>
              <p>
                Result row {request.rowIndex + 1} · {request.metric}
              </p>
              <pre>
                {JSON.stringify(evidence.rows[request.rowIndex], null, 2)}
              </pre>
            </section>
          )}
          {request.rowIndex === undefined && (
            <section>
              <h3>Query results</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Segment</th>
                      {evidence.spec.metrics.map((metric) => (
                        <th key={metric}>{metric}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {evidence.rows.map((row, index) => (
                      <tr key={index}>
                        <td>
                          {row.period}
                          {row.bucket ? ` / ${row.bucket}` : ""}
                        </td>
                        <td>
                          {Object.values(row.dimensions).join(" / ") ||
                            "Overall"}
                        </td>
                        {evidence.spec.metrics.map((metric) => (
                          <td key={metric}>
                            {row.values[metric] === null ||
                            row.values[metric] === undefined
                              ? "—"
                              : String(row.values[metric])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <h3>Metric definitions</h3>
          <dl>
            {Object.entries(evidence.definitions).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3>Executed scope</h3>
          <pre>{JSON.stringify(evidence.spec, null, 2)}</pre>
          {evidence.coverage.length > 0 && (
            <>
              <h3>Follow-up coverage</h3>
              {evidence.coverage.map((c) => (
                <p key={c.period}>
                  {c.period}: included through {c.effectiveEnd} (exclusive);
                  excluded {c.excludedUsers} users without complete follow-up.
                </p>
              ))}
            </>
          )}
          {evidence.sql.map((sql, i) => (
            <section key={i}>
              <h3>Query {i + 1}</h3>
              <p className="mono wrap">
                queryId: {evidence.queryIds[i] ?? "Not provided"}
              </p>
              <pre>{sql}</pre>
            </section>
          ))}
          {evidence.notes.map((note, i) => (
            <p className="caption" key={i}>
              {note}
            </p>
          ))}
        </>
      )}
    </dialog>
  );
}
