import fs from "node:fs/promises";
import { CONTRACT_VERSION } from "@storewhy/contracts";
const root = process.env.STOREWHY_HTTP_URL ?? "http://127.0.0.1:3100";
const checks: { name: string; pass: boolean; detail: unknown }[] = [];
async function get(path: string) {
  const r = await fetch(root + path, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`);
  return r.json();
}
try {
  const health = await get("/healthz");
  checks.push({
    name: "runtime-version",
    pass: health.apiVersion === CONTRACT_VERSION,
    detail: health,
  });
  const integrations = await get("/api/v1/integrations");
  checks.push({
    name: "live-data",
    pass:
      health.dataMode === "zetaris" && integrations.data.status === "online",
    detail: integrations.data,
  });
  checks.push({
    name: "live-model",
    pass: integrations.model.status === "online",
    detail: integrations.model,
  });
  const catalog = await get("/api/v1/catalog");
  checks.push({
    name: "teaching-sample-disclosure",
    pass:
      catalog.dataset.kind === "public_teaching_sample" &&
      catalog.dateEndIsExclusive,
    detail: {
      kind: catalog.dataset.kind,
      start: catalog.dataset.start,
      end: catalog.dataset.observationEndExclusive,
    },
  });
  const doc = await get("/api/v1/openapi.json");
  checks.push({
    name: "ui-contract",
    pass:
      !!doc.components.schemas.RunProgress &&
      !!doc.components.schemas.Explanation &&
      !!doc.components.schemas.FollowupAction,
    detail: { version: doc.info.version },
  });
  const cors = await fetch(root + "/api/v1/conversations", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
    },
  });
  checks.push({
    name: "vite-origin",
    pass:
      cors.headers.get("access-control-allow-origin") ===
      "http://localhost:5173",
    detail: { status: cors.status },
  });
} catch (error) {
  checks.push({
    name: "connectivity",
    pass: false,
    detail: error instanceof Error ? error.message : String(error),
  });
}
const report = {
  at: new Date().toISOString(),
  kind: "read_only_demo_preflight_no_agent_or_publication",
  root,
  pass: checks.every((c) => c.pass),
  checks,
};
await fs.writeFile(
  "evidence/demo-preflight.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
if (!report.pass) process.exitCode = 1;
