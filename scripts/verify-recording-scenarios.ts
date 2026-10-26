import assert from "node:assert/strict";
import fs from "node:fs";
import { parse } from "dotenv";
import type { Conversation, Evidence, Run } from "@storewhy/contracts";
import { remoteConfiguration, SHARE_HEADER } from "./lib/shared-backend.ts";
const remote = remoteConfiguration(
  parse(
    fs.readFileSync(
      process.env.STOREWHY_REMOTE_CONFIG ?? ".state/share/teammate.env",
    ),
  ),
);
type Turn = {
  id: string;
  question: string;
  months: [string, string];
  channel?: string;
  days: 7 | 14;
  unsupported?: boolean;
  behaviorOnly?: boolean;
};
const groups: { id: string; title: string; turns: Turn[] }[] = [
  {
    id: "spend-and-revenue",
    title: "July versus June: spend and revenue",
    turns: [
      {
        id: "paid-14",
        question:
          "Why did recorded spend increase in July 2019 versus June 2019, while new users' revenue within 14 days of first visit failed to keep pace? Use paid acquisition channels.",
        months: ["2019-06", "2019-07"],
        days: 14,
      },
      {
        id: "faceboom-14",
        question:
          "Focus on FaceBoom. Keep the same dates and the 14-day window after first visit.",
        months: ["2019-06", "2019-07"],
        channel: "FaceBoom",
        days: 14,
      },
      {
        id: "faceboom-7",
        question:
          "Use 7 days after first visit instead. Keep FaceBoom and the same dates.",
        months: ["2019-06", "2019-07"],
        channel: "FaceBoom",
        days: 7,
      },
      {
        id: "missing-ctr-main",
        question: "Why did FaceBoom ad CTR fall over that period?",
        months: ["2019-06", "2019-07"],
        channel: "FaceBoom",
        days: 7,
        unsupported: true,
      },
      {
        id: "purchase-composition",
        question:
          "Split the revenue change into first and subsequent purchase revenue. Keep the same channel, dates and 7-day window.",
        months: ["2019-06", "2019-07"],
        channel: "FaceBoom",
        days: 7,
      },
    ],
  },
  {
    id: "later-months",
    title: "August to October: channel and maturity checks",
    turns: [
      {
        id: "tiptop-september-7",
        question:
          "Why did recorded spend and new-user revenue within 7 days of first visit change on TipTop in September 2019 compared with August 2019?",
        months: ["2019-08", "2019-09"],
        channel: "TipTop",
        days: 7,
      },
      {
        id: "rocket-september-7",
        question:
          "Switch to RocketSuperAds. Keep September versus August 2019 and the 7-day window after first visit.",
        months: ["2019-08", "2019-09"],
        channel: "RocketSuperAds",
        days: 7,
      },
      {
        id: "rocket-september-14",
        question:
          "Change the window to 14 days after first visit. Keep RocketSuperAds and the same dates.",
        months: ["2019-08", "2019-09"],
        channel: "RocketSuperAds",
        days: 14,
      },
      {
        id: "rocket-october-14",
        question:
          "Now compare October 2019 with September 2019. Keep RocketSuperAds and the 14-day window after first visit.",
        months: ["2019-09", "2019-10"],
        channel: "RocketSuperAds",
        days: 14,
      },
    ],
  },
  {
    id: "purchasing-behavior",
    title: "May to July: purchasing behavior and missing data",
    turns: [
      {
        id: "faceboom-june-7",
        question:
          "Why did the first-week purchaser rate for new users differ on FaceBoom in June 2019 versus May 2019? Check user behavior only, without spend analysis.",
        months: ["2019-05", "2019-06"],
        channel: "FaceBoom",
        days: 7,
        behaviorOnly: true,
      },
      {
        id: "faceboom-july-7",
        question:
          "Compare July 2019 with June 2019 instead. Keep FaceBoom, the 7-day window and the same behavior metrics. Do not analyze spend.",
        months: ["2019-06", "2019-07"],
        channel: "FaceBoom",
        days: 7,
        behaviorOnly: true,
      },
      {
        id: "faceboom-july-14",
        question:
          "Use 14 days after first visit. Keep FaceBoom, the same dates and behavior metrics. Do not analyze spend.",
        months: ["2019-06", "2019-07"],
        channel: "FaceBoom",
        days: 14,
        behaviorOnly: true,
      },
      {
        id: "missing-ctr",
        question: "Why did FaceBoom ad CTR fall over that period?",
        months: ["2019-06", "2019-07"],
        channel: "FaceBoom",
        days: 14,
        behaviorOnly: true,
        unsupported: true,
      },
    ],
  },
];
const selected = process.argv
  .find((value) => value.startsWith("--group="))
  ?.split("=")[1];
if (selected && !groups.some((group) => group.id === selected))
  throw new Error("Unknown question group");
async function request<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(remote.target + "/api/v1" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      [SHARE_HEADER]: remote.token,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(`StoreWhy API returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
const records: unknown[] = [];
let pass = true;
for (const group of groups.filter(
  (group) => !selected || group.id === selected,
)) {
  const conversation = await request<Conversation>("/conversations", {});
  for (const turn of group.turns) {
    const started = Date.now();
    let run: Run | undefined;
    try {
      run = await request<Run>(`/conversations/${conversation.id}/messages`, {
        message: turn.question,
      });
      const deadline = Date.now() + 360000;
      while (["queued", "running"].includes(run.status)) {
        if (Date.now() >= deadline)
          throw new Error(
            "Investigation exceeded verification deadline; do not resubmit automatically",
          );
        await new Promise((resolve) => setTimeout(resolve, 1500));
        run = await request<Run>(`/runs/${run.id}`);
      }
      assert.ok(
        (turn.unsupported
          ? ["unsupported"]
          : ["completed", "limited"]
        ).includes(run.status),
        run.message ?? run.status,
      );
      assert.deepEqual(
        run.context.spec.periods.map((period) => period.start),
        turn.months.map((month) => month + "-01"),
      );
      assert.deepEqual(
        run.context.spec.periods.map((period) => period.end),
        turn.months.map((month) => {
          const [year, monthNumber] = month.split("-").map(Number);
          return new Date(Date.UTC(year, monthNumber, 1))
            .toISOString()
            .slice(0, 10);
        }),
      );
      assert.equal(
        run.context.taskKind,
        turn.id === "purchase-composition" ? "query" : "why",
      );
      assert.equal(
        run.context.objective,
        turn.id === "purchase-composition"
          ? turn.question
          : group.turns[0].question,
      );
      assert.equal(run.context.spec.mode, "cohort");
      assert.equal(run.context.spec.windowDays, turn.days);
      assert.equal(run.context.spec.audience, "paid");
      assert.deepEqual(
        run.context.spec.filters.channels,
        turn.channel ? [turn.channel] : [],
      );
      assert.deepEqual(run.context.spec.filters.devices, []);
      assert.deepEqual(run.context.spec.filters.regions, []);
      if (turn.behaviorOnly)
        assert.ok(
          !run.context.spec.metrics.some((metric) =>
            ["spend", "cost_per_new_user", "revenue_to_spend"].includes(metric),
          ),
        );
      if (!turn.unsupported) {
        assert.ok(run.answer?.summary && run.evidenceIds.length);
        if (turn.id === "purchase-composition") {
          assert.match(run.answer.summary, /first purchase revenue/i);
          assert.match(run.answer.summary, /subsequent purchase revenue/i);
        } else if (turn.behaviorOnly) {
          assert.match(run.answer.summary, /purchaser rate/i);
        }
        assert.doesNotMatch(run.answer.summary, /\p{Script=Han}/u);
        const sources = new Map<string, Evidence>();
        for (const id of run.evidenceIds) {
          const evidence = await request<Evidence>(`/evidence/${id}`);
          assert.equal(evidence.backend, "zetaris");
          assert.ok(evidence.queryIds.length);
          sources.set(id, evidence);
        }
        for (const fact of run.answer.facts)
          assert.equal(
            fact.value,
            sources.get(fact.evidenceId)!.rows[fact.rowIndex].values[
              fact.metric
            ] ?? null,
          );
        for (const chart of run.answer.charts ?? [])
          for (const series of chart.series)
            for (const point of series.points)
              assert.equal(
                point.value,
                sources.get(point.source.evidenceId)!.rows[
                  point.source.rowIndex
                ].values[point.source.metric] ?? null,
              );
        assert.ok(
          run.modelTraces.some(
            (trace) =>
              trace.provider === "nvidia" &&
              trace.status === "ok" &&
              trace.receiptId,
          ),
        );
        const coverage = [...sources.values()].flatMap((e) =>
          e.coverage.map((c) => ({ evidenceId: e.id, ...c })),
        );
        records.push({
          group: group.id,
          ...turn,
          pass: true,
          runId: run.id,
          status: run.status,
          elapsedMs: Date.now() - started,
          spec: run.context.spec,
          taskKind: run.context.taskKind,
          objective: run.context.objective,
          conclusion: run.answer.summary,
          factCount: run.answer.facts.length,
          chartPoints: (run.answer.charts ?? []).reduce(
            (n, chart) =>
              n +
              chart.series.reduce((s, series) => s + series.points.length, 0),
            0,
          ),
          coverage,
          queryIds: [...sources.values()].flatMap((e) => e.queryIds),
          modelTraces: run.modelTraces,
        });
      } else {
        assert.equal(run.answer, undefined);
        assert.deepEqual(run.evidenceIds, []);
        records.push({
          group: group.id,
          ...turn,
          pass: true,
          runId: run.id,
          status: run.status,
          elapsedMs: Date.now() - started,
          message: run.message,
          spec: run.context.spec,
          taskKind: run.context.taskKind,
          objective: run.context.objective,
        });
      }
      console.log(
        JSON.stringify({
          group: group.id,
          turn: turn.id,
          status: run.status,
          seconds: Math.round((Date.now() - started) / 1000),
          pass: true,
        }),
      );
    } catch (error) {
      pass = false;
      const message = (error instanceof Error ? error.message : String(error))
        .split(remote.token)
        .join("[redacted]");
      records.push({
        group: group.id,
        ...turn,
        pass: false,
        runId: run?.id,
        status: run?.status,
        spec: run?.context.spec,
        error: message,
        elapsedMs: Date.now() - started,
        runtimeError: run?.error,
        modelTraces: run?.modelTraces,
      });
      console.log(
        JSON.stringify({
          group: group.id,
          turn: turn.id,
          pass: false,
          error: message,
        }),
      );
      break;
    }
  }
}
const output = `evidence/recording-scenarios${selected ? "-" + selected : ""}.json`;
fs.writeFileSync(
  output,
  JSON.stringify(
    { at: new Date().toISOString(), viaPublicHttps: true, pass, records },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ pass, turns: records.length, output }));
if (!pass) process.exitCode = 1;
