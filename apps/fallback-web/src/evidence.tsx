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
          setError(e instanceof Error ? e.message : "无法读取证据");
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
          <h2 id="evidence-title">查看分析依据</h2>
        </div>
        <button onClick={close} autoFocus>
          关闭
        </button>
      </div>
      {error ? (
        <div role="alert" className="notice error">
          {error}
          <button onClick={() => setRetry((v) => v + 1)}>重新读取</button>
        </div>
      ) : !evidence ? (
        <p role="status">正在读取证据…</p>
      ) : (
        <>
          <p className="caption">
            {evidence.backend === "zetaris"
              ? "Zetaris 查询结果"
              : "自制样例数据"}{" "}
            · {evidence.datasetVersion}
          </p>
          <p className="mono wrap">{evidence.id}</p>
          {request.rowIndex !== undefined && (
            <section className="source-cell">
              <h3>此处引用的数值</h3>
              <p>
                结果第 {request.rowIndex + 1} 行 · {request.metric}
              </p>
              <pre>
                {JSON.stringify(evidence.rows[request.rowIndex], null, 2)}
              </pre>
            </section>
          )}
          <h3>指标定义</h3>
          <dl>
            {Object.entries(evidence.definitions).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3>实际执行条件</h3>
          <pre>{JSON.stringify(evidence.spec, null, 2)}</pre>
          {evidence.coverage.length > 0 && (
            <>
              <h3>观察期覆盖</h3>
              {evidence.coverage.map((c) => (
                <p key={c.period}>
                  {c.period}：实际统计至 {c.effectiveEnd}（不含），排除{" "}
                  {c.excludedUsers} 位随访未满用户。
                </p>
              ))}
            </>
          )}
          {evidence.sql.map((sql, i) => (
            <section key={i}>
              <h3>查询 {i + 1}</h3>
              <p className="mono wrap">
                queryId: {evidence.queryIds[i] ?? "未提供"}
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
