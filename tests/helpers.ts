import { z } from "zod";
import type {
  ModelGateway,
  ChatMessage,
} from "../apps/server/src/integrations/nightshift.ts";
import type { ModelTrace, Run } from "@storewhy/contracts";
import type { Engine } from "../apps/server/src/agents/engine.ts";
export class ScriptedGateway implements ModelGateway {
  async structured<T>(
    role: string,
    schema: z.ZodType<T>,
    messages: ChatMessage[],
    traces: ModelTrace[],
    _signal?: AbortSignal,
  ): Promise<T> {
    traces.push({
      role,
      model: "scripted-test",
      provider: "test-only",
      durationMs: 0,
    });
    const data = JSON.parse(messages.at(-1)!.content);
    let out: unknown;
    if (role === "investigator.intent")
      out = {
        kind: "why",
        patch: { metrics: ["spend", "new_users", "revenue"] },
      };
    else if (role === "investigator.explain")
      out = {
        observationIds: [
          data.observations.find(
            (o: any) => o.evidenceId === data.evidence[0].id,
          ).id,
        ],
        hypothesis: "channel_mix",
        suggestedQuery: null,
      };
    else
      out = data.evidence.some((e: any) => e.scope.groupBy.includes("channel"))
        ? {
            decision: "ready",
            reason: "渠道拆分已提供，可以给出观测解释。",
            query: null,
            issues: [],
          }
        : {
            decision: "needs_query",
            reason: "整体结果不足以判断渠道贡献，需要拆分。",
            query: { groupBy: ["channel"] },
            issues: ["缺少渠道结构"],
          };
    return schema.parse(out);
  }
}
export async function wait(engine: Engine, id: string) {
  for (let i = 0; i < 400; i++) {
    const r = engine.store.get<Run>("runs", id);
    if (!["queued", "running"].includes(r.status)) return r;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Run did not finish");
}
