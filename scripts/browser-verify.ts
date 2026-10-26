import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { buildApp } from "../apps/server/src/app.ts";
import { ZetarisBackend } from "../apps/server/src/integrations/zetaris.ts";
import { ScriptedGateway } from "../tests/helpers.ts";
import type { Run } from "@storewhy/contracts";
import type { ModelGateway } from "../apps/server/src/integrations/nightshift.ts";
const live = process.argv.includes("--live");
const dir = mkdtempSync(path.join(tmpdir(), "storewhy-browser-"));
const scripted = new ScriptedGateway();
const gateway: ModelGateway = {
  async structured(role, schema, messages, traces, signal) {
    await new Promise((r) => setTimeout(r, 100));
    if (
      role === "investigator.intent" &&
      /CTR/.test(JSON.parse(messages.at(-1)!.content).currentQuestion)
    )
      return schema.parse({
        kind: "unsupported",
        patch: {},
        message: "自制测试样例没有曝光、点击与素材，无法判断 CTR。",
      });
    return scripted.structured(role, schema, messages, traces, signal);
  },
};
const server = await buildApp({
  ...(live ? { backend: new ZetarisBackend() } : { gateway }),
  stateDir: dir,
});
const bundle = await build({
  entryPoints: ["tests/browser/harness.ts"],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  target: "es2022",
});
server.app.get("/__test__/harness", async (_req, reply) =>
  reply
    .type("text/html")
    .send(await fs.readFile("tests/browser/harness.html", "utf8")),
);
server.app.get("/__test__/harness.js", (_req, reply) =>
  reply.type("text/javascript").send(bundle.outputFiles[0].text),
);
await server.app.listen({ host: "127.0.0.1", port: 0 });
const a = server.app.server.address();
assert.ok(a && typeof a !== "string");
const root = `http://127.0.0.1:${a.port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.STOREWHY_CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
page.setDefaultTimeout(live ? 360000 : 15000);
const errors: string[] = [],
  records: unknown[] = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push("console: " + message.text());
});
let lastRunId = "";
async function done(name: string) {
  await page.waitForFunction((previous) => {
    const node = document.getElementById("status")!;
    return (
      node.dataset.runId !== previous &&
      !["初始化", "ready", "queued", "running"].includes(node.textContent ?? "")
    );
  }, lastRunId);
  const record = await page.evaluate(() => ({
    status: document.getElementById("status")!.textContent,
    runId: document.getElementById("status")!.dataset.runId,
    summary: document.getElementById("summary")!.textContent,
    scope: JSON.parse(document.getElementById("scope")!.textContent!),
  }));
  assert.ok(
    ["completed", "limited", "unsupported", "cancelled"].includes(
      record.status!,
    ),
  );
  assert.equal(await page.locator("#error").textContent(), "");
  lastRunId = record.runId!;
  records.push({ name, ...record });
  console.log(JSON.stringify({ name, status: record.status }));
  return record;
}
try {
  await page.goto(root + "/__test__/harness");
  await page.waitForFunction(
    () => document.getElementById("status")?.textContent === "ready",
  );
  await page.locator("#send").click();
  await page.waitForFunction(
    () =>
      document.getElementById("status")?.textContent === "queued" ||
      document.getElementById("status")?.textContent === "running",
  );
  await page.reload();
  const main = await done("main-why-after-reload");
  assert.equal(main.scope.windowDays, 14);
  assert.equal(main.scope.audience, "paid");
  const rectangles = await page
    .locator("svg rect")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({ ...(n as SVGElement).dataset })),
    );
  assert.ok(rectangles.length);
  assert.ok(main.runId);
  const mainRun = server.disk.get<Run>("runs", main.runId);
  const expectedPoints = (mainRun.answer?.charts ?? [])
    .flatMap((c) => c.series.flatMap((s) => s.points))
    .filter((p) => p.value !== null).length;
  assert.equal(
    rectangles.length,
    expectedPoints,
    "render and validate every non-null chart point",
  );
  for (const point of rectangles) {
    const e = await (
      await fetch(root + "/api/v1/evidence/" + point.evidenceId)
    ).json();
    assert.equal(
      e.rows[Number(point.rowIndex)].values[point.metric!],
      Number(point.value),
    );
  }
  await page.locator("#evidence .evidence").first().click();
  await page.waitForFunction(() =>
    document.getElementById("sql")?.textContent?.includes("WITH"),
  );
  await page.screenshot({
    path: `evidence/browser-${live ? "live" : "fixture"}-main.png`,
    fullPage: true,
  });
  await page.locator("#channel").click();
  const channel = await done("channel-followup");
  assert.deepEqual(channel.scope.filters.channels, ["FaceBoom"]);
  assert.deepEqual(channel.scope.periods, main.scope.periods);
  await page.locator("#window").click();
  const window = await done("window-followup");
  assert.equal(window.scope.windowDays, 7);
  assert.deepEqual(window.scope.filters.channels, ["FaceBoom"]);
  await page.locator("#remember").click();
  await page.waitForFunction(() =>
    document
      .getElementById("memory")
      ?.textContent?.includes("user-preference:"),
  );
  await page.locator("#reset").click();
  const restored = await done("memory-window-restored");
  assert.equal(restored.scope.windowDays, 7);
  assert.deepEqual(restored.scope.filters.channels, []);
  assert.match(
    (await page.locator("#memory").textContent()) ?? "",
    /来源|user-preference/,
  );
  await page.locator("#send").click();
  await page.waitForFunction(
    () => !(document.getElementById("cancel") as HTMLButtonElement).disabled,
  );
  await page.locator("#cancel").click();
  const cancelled = await done("cancel-in-progress");
  assert.equal(cancelled.status, "cancelled");
  if (live) {
    await page
      .locator("#question")
      .fill(
        "为什么FaceBoom在2019年8月相较7月新用户首周购买用户比例不同？请只检查行为数据，不分析广告费用。",
      );
    await page.locator("#send").click();
    await done("reviewer-followup-path");
  }
  await page.locator("#missing").click();
  const missing = await done("missing-click-data");
  assert.equal(missing.status, "unsupported");
  assert.equal(await page.locator("#charts svg").count(), 0);
  await page.screenshot({
    path: `evidence/browser-${live ? "live" : "fixture"}.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  const runs = server.disk.list<any>("runs");
  assert.equal(
    runs.length,
    records.length,
    "reload must not create duplicate runs",
  );
  assert.ok(
    runs.some((r) =>
      r.events.some(
        (e: any, index: number) =>
          e.type === "review_completed" &&
          e.data?.decision === "needs_query" &&
          r.events
            .slice(index + 1)
            .some(
              (later: any) =>
                later.type === "query_completed" &&
                r.evidenceIds.includes(later.data?.evidenceId),
            ),
      ),
    ),
    "a real Reviewer query must be executed",
  );
  const report = {
    at: new Date().toISOString(),
    kind: "browser_contract_harness_not_teammate_react_ui",
    mode: live ? "live" : "self_authored_fixture",
    pass: true,
    reloadRestored: true,
    noDuplicateRunsAfterReload: true,
    chartPointsVerified: rectangles.length,
    allNonNullPointsRendered: true,
    memoryRestoredWithSource: true,
    reviewerRequestedQuery: true,
    reviewerExecutedQuery: true,
    consoleErrors: errors,
    records,
  };
  await fs.writeFile(
    `evidence/browser-${live ? "live" : "fixture"}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
} catch (error) {
  await fs.writeFile(
    `evidence/browser-${live ? "live" : "fixture"}-development.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        kind: "browser_contract_harness_failure",
        pass: false,
        error: error instanceof Error ? error.message : String(error),
        records,
        consoleErrors: errors,
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  await browser.close();
  await server.app.close();
}
