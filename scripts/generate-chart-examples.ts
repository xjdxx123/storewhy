import fs from "node:fs/promises";
import { DEFAULT_SPEC, chartResponseSchema } from "@storewhy/contracts";
import { FixtureBackend } from "../apps/server/src/integrations/fixture.ts";
import { Analytics } from "../apps/server/src/analytics/service.ts";
import { chartsFor } from "../apps/server/src/analytics/charts.ts";
const backend = new FixtureBackend();
try {
  await backend.initialize();
  const analytics = new Analytics(backend, "self-authored-fixture-v1");
  const specs = [
    { ...DEFAULT_SPEC, groupBy: ["channel" as const] },
    {
      ...DEFAULT_SPEC,
      mode: "calendar" as const,
      timeGrain: "day" as const,
      periods: [DEFAULT_SPEC.periods[0]],
      metrics: ["revenue" as const],
    },
    {
      ...DEFAULT_SPEC,
      metrics: [
        "first_purchase_revenue" as const,
        "repeat_purchase_revenue" as const,
      ],
    },
  ];
  const examples = [];
  for (const spec of specs) {
    const evidence = await analytics.query(spec);
    const response = chartResponseSchema.parse(chartsFor([evidence]));
    examples.push({ evidence, response });
  }
  await fs.mkdir("docs/examples", { recursive: true });
  await fs.writeFile(
    "docs/examples/charts.json",
    JSON.stringify(
      {
        notice:
          "Self-authored fixture examples; offline mocks, not live query receipts. Source Evidence is embedded for inspection.",
        examples,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Generated three evidence-bound chart examples from the self-authored fixture.",
  );
} finally {
  await backend.close();
}
