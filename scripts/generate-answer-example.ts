import fs from "node:fs/promises";
import { DEFAULT_SPEC } from "@storewhy/contracts";
import { FixtureBackend } from "../apps/server/src/integrations/fixture.ts";
import { Analytics } from "../apps/server/src/analytics/service.ts";
import { factsFor } from "../apps/server/src/agents/engine.ts";
import { observationsFor } from "../apps/server/src/analytics/observations.ts";
import { presentAnswer } from "../apps/server/src/analytics/report.ts";
import { chartsFor } from "../apps/server/src/analytics/charts.ts";
import { initialContext } from "../apps/server/src/context/store.ts";
const backend = new FixtureBackend();
try {
  await backend.initialize();
  const analytics = new Analytics(backend, "self-authored-fixture-v1");
  const evidence = [
    await analytics.query(DEFAULT_SPEC),
    await analytics.query({ ...DEFAULT_SPEC, groupBy: ["channel"] }),
  ];
  const facts = factsFor(evidence),
    observations = observationsFor(evidence, facts);
  const lead = observations.find(
    (o) => o.kind === "joint" && o.focus?.channel === "TipTop",
  )!;
  const context = initialContext(
    "fixture-conversation",
    "self-authored-fixture-v1",
  );
  context.revision = 1;
  context.taskKind = "why";
  context.objective = "为什么新用户收入与费用变化不同？";
  context.evidenceIds = evidence.map((e) => e.id);
  const answer = presentAnswer({
    context,
    evidence,
    facts,
    selected: [lead, ...observations.filter((o) => o.kind === "contribution")],
    headlineObservationId: lead.id,
    ready: false,
  });
  const charts = chartsFor(evidence);
  answer.charts = charts.charts;
  answer.chartNotes = charts.notes;
  await fs.mkdir("docs/examples", { recursive: true });
  await fs.writeFile(
    "docs/examples/answer.json",
    JSON.stringify(
      {
        notice:
          "Self-authored fixture and deterministic presentation only; no online model/reviewer. IDs are offline mock identifiers. Real recommendations require a live conversation.",
        status: "limited",
        context,
        answer,
        evidence,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Generated grounded answer / key evidence / followup mock from the self-authored fixture.",
  );
} finally {
  await backend.close();
}
