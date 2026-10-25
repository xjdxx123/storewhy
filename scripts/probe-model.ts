import { z } from "zod";
import { Nightshift } from "../apps/server/src/integrations/nightshift.ts";
import type { ModelTrace } from "@storewhy/contracts";
import fs from "node:fs/promises";
const gateway = new Nightshift();
const schema = z
  .object({
    operation: z.enum(["compare", "filter", "window"]),
    month: z.number().nullable(),
    channel: z.string().nullable(),
    windowDays: z.union([z.literal(7), z.literal(14)]).nullable(),
  })
  .strict();
const traces: ModelTrace[] = [];
const results = [];
for (const message of [
  "对比 2019 年 7 月和 6 月，广告费用为什么增加？",
  "只看 FaceBoom 渠道",
  "改成首访后 7 天观察窗口",
]) {
  results.push({
    message,
    result: await gateway.structured(
      "probe",
      schema,
      [
        {
          role: "system",
          content:
            "Extract the operation. Months are numeric. Use null for unspecified month, channel or window.",
        },
        { role: "user", content: message },
      ],
      traces,
    ),
  });
}
await fs.mkdir("evidence", { recursive: true });
await fs.writeFile(
  "evidence/model-probe.json",
  JSON.stringify({ results, traces }, null, 2),
);
console.log(JSON.stringify({ results, traces }, null, 2));
