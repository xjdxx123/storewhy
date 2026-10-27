import { it, expect } from "vitest";
import { FixtureBackend } from "../apps/server/src/integrations/fixture.ts";
import { Analytics } from "../apps/server/src/analytics/service.ts";
import { factsFor } from "../apps/server/src/agents/engine.ts";
import {
  observationsFor,
  validateSelection,
} from "../apps/server/src/analytics/observations.ts";
import { DEFAULT_SPEC } from "@storewhy/contracts";
it("renders comparison statements from exact matching source rows rather than model arithmetic", async () => {
  const backend = new FixtureBackend();
  try {
    await backend.initialize();
    const e = await new Analytics(backend, "fixture").query(DEFAULT_SPEC);
    const facts = factsFor([e]),
      obs = observationsFor([e], facts);
    const joint = obs.find((o) => o.kind === "joint")!;
    expect(joint.text).toContain("spend in the first 14 days");
    expect(joint.text).toContain("increased by 36");
    expect(joint.text).toContain("revenue changed by 0");
    expect(joint.factIds).toHaveLength(4);
    expect(joint.factIds.every((id) => facts.some((f) => f.id === id))).toBe(
      true,
    );
    expect(validateSelection([joint.id], obs)).toEqual([joint]);
  } finally {
    await backend.close();
  }
});
