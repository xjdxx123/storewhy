import fs from "node:fs/promises";
import { z } from "zod";
import { Nightshift } from "../apps/server/src/integrations/nightshift.ts";
import type { ModelTrace } from "@storewhy/contracts";
const trace: ModelTrace[] = [];
try {
  const value = await new Nightshift({
    jsonMode: true,
    timeoutMs: 20000,
  }).structured(
    "output-format-probe",
    z.object({ observationIds: z.array(z.string()).max(2) }).strict(),
    [
      {
        role: "user",
        content:
          'Select only the two most relevant IDs from a,b,c,d and return JSON data: {"observationIds":["a","b"]}.',
      },
    ],
    trace,
  );
  const result = {
    at: new Date().toISOString(),
    kind: "capability_probe_not_schema_guarantee",
    accepted: true,
    value,
    traces: trace,
  };
  await fs.writeFile(
    "evidence/output-format-probe.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} catch (error) {
  const result = {
    at: new Date().toISOString(),
    kind: "capability_probe_not_schema_guarantee",
    accepted: false,
    error: error instanceof Error ? error.message : String(error),
    traces: trace,
  };
  await fs.writeFile(
    "evidence/output-format-probe.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
}
