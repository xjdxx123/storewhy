import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { buildApp } from "../apps/server/src/app.ts";
import { FixtureBackend } from "../apps/server/src/integrations/fixture.ts";
import { ZetarisBackend } from "../apps/server/src/integrations/zetaris.ts";
import { ScriptedGateway } from "../tests/helpers.ts";
import { AppError } from "../apps/server/src/config.ts";
import type { ModelGateway } from "../apps/server/src/integrations/nightshift.ts";
import type { Chart, Evidence, Run } from "@storewhy/contracts";
const live = process.argv.includes("--live");
const mode = live ? "live" : "fixture";
const stateDir = mkdtempSync(path.join(tmpdir(), "storewhy-react-ui-"));
const scripted = new ScriptedGateway();
const gateway: ModelGateway = {
  async structured(role, schema, messages, traces, signal) {
    if (role === "investigator.intent") {
      const question = JSON.parse(messages.at(-1)!.content)
        .currentQuestion as string;
      await new Promise((r) =>
        setTimeout(r, question.includes("cancel test") ? 1500 : 200),
      );
      if (question.includes("test model offline"))
        throw new AppError(
          "MODEL_OFFLINE",
          "Injected test failure: the model service is unavailable",
          503,
        );
      if (question.includes("CTR"))
        return schema.parse({
          kind: "unsupported",
          patch: {},
          message:
            "The self-authored sample has no impression or click data, so CTR cannot be checked.",
        });
    } else await new Promise((r) => setTimeout(r, 200));
    return scripted.structured(role, schema, messages, traces, signal);
  },
};
const fixture = live ? undefined : new FixtureBackend();
await fixture?.initialize();
const backend = await buildApp({
  backend: fixture ?? new ZetarisBackend(),
  ...(live ? {} : { gateway }),
  stateDir,
});
await backend.app.listen({ host: "127.0.0.1", port: 0 });
const address = backend.app.server.address();
assert.ok(address && typeof address !== "string");
const apiRoot = `http://127.0.0.1:${address.port}`;
const web = await createServer({
  root: path.resolve("apps/fallback-web"),
  configFile: path.resolve("apps/fallback-web/vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
    proxy: { "/api": { target: apiRoot }, "/healthz": { target: apiRoot } },
  },
});
await web.listen();
const webAddress = web.httpServer!.address();
assert.ok(webAddress && typeof webAddress !== "string");
const root = `http://127.0.0.1:${webAddress.port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.STOREWHY_CHROME ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.setDefaultTimeout(live ? 360000 : 30000);
const errors: string[] = [],
  records: unknown[] = [],
  checks: Record<string, boolean | number> = {};
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (e) => {
  if (e.type() === "error") errors.push(e.text());
});
let previous = "";
async function finished(name: string, expected = ["completed", "limited"]) {
  await page.waitForFunction(
    ({ previous, expected }) => {
      const state = document.querySelector<HTMLElement>(
        '[data-testid="run-state"]',
      );
      return (
        !!state?.dataset.runId &&
        state.dataset.runId !== previous &&
        expected.includes(state.dataset.status!)
      );
    },
    { previous, expected },
  );
  const id = await page.getByTestId("run-state").getAttribute("data-run-id");
  assert.ok(id);
  const response = await page.request.get(`${apiRoot}/api/v1/runs/${id}`);
  assert.ok(response.ok());
  const run = (await response.json()) as Run;
  assert.ok(expected.includes(run.status));
  assert.doesNotMatch(
    JSON.stringify({
      question: run.question,
      message: run.message,
      progress: run.progress,
      events: run.events.map(({ message, data }) => ({ message, data })),
      answer: run.answer,
      warnings: run.warnings,
    }),
    /[\u3400-\u9fff]/u,
    `${name} exposed non-English UI text`,
  );
  assert.equal(await page.getByRole("alert").count(), 0);
  previous = run.id;
  records.push({
    name,
    runId: id,
    status: run.status,
    spec: run.context.spec,
    summary: run.answer?.summary ?? run.message,
  });
  console.log(JSON.stringify({ name, status: run.status }));
  return run;
}
async function send(question: string) {
  await page
    .getByLabel(/What changed—and why\?|Continue this investigation/)
    .fill(question);
  await page.getByRole("button", { name: "Investigate", exact: true }).click();
}
try {
  await page.goto(root);
  await page
    .getByRole("button", { name: "Investigate", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      !(document.querySelector('button[type="submit"]') as HTMLButtonElement)
        ?.disabled,
  );
  checks.reactPageLoaded = true;
  await page.screenshot({
    path: `evidence/fallback-ui-${mode}-empty.png`,
    fullPage: true,
  });
  const question = await page.getByLabel("What changed—and why?").inputValue();
  await send(question);
  await page.waitForFunction(() =>
    ["queued", "running"].includes(
      document.querySelector<HTMLElement>('[data-testid="run-state"]')?.dataset
        .status ?? "",
    ),
  );
  await page.reload();
  const main = await finished("main-after-refresh");
  assert.equal(main.context.spec.windowDays, 14);
  const conversation = await (
    await page.request.get(
      `${apiRoot}/api/v1/conversations/${main.conversationId}`,
    )
  ).json();
  assert.equal(conversation.runIds.length, 1);
  checks.refreshWithoutDuplicatePost = true;
  const points = await page.locator("svg [data-value]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      evidenceId: node.getAttribute("data-evidence-id")!,
      rowIndex: Number(node.getAttribute("data-row-index")),
      metric: node.getAttribute("data-metric")!,
      value: Number(node.getAttribute("data-value")),
    })),
  );
  const expectedPoints = (main.answer?.charts ?? []).flatMap((c) =>
    c.series.flatMap((s) => s.points.filter((p) => p.value !== null)),
  );
  assert.equal(points.length, expectedPoints.length);
  assert.ok(points.length > 0);
  const cache = new Map<string, Evidence>();
  for (const point of points) {
    if (!cache.has(point.evidenceId))
      cache.set(
        point.evidenceId,
        await (
          await page.request.get(
            `${apiRoot}/api/v1/evidence/${point.evidenceId}`,
          )
        ).json(),
      );
    const evidence = cache.get(point.evidenceId)!;
    assert.equal(
      point.value,
      evidence.rows[point.rowIndex].values[
        point.metric as keyof (typeof evidence.rows)[number]["values"]
      ],
    );
  }
  checks.allChartPointsBound = points.length;
  await page
    .getByRole("button", { name: /^View evidence/ })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByText("queryId:", { exact: false })
    .first()
    .waitFor();
  const dialogText = await page.getByRole("dialog").textContent();
  assert.ok(dialogText?.includes("SELECT"));
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  checks.evidenceSqlAndEscape = true;
  await page.screenshot({
    path: `evidence/fallback-ui-${mode}-main.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "FaceBoom only", exact: true })
    .click();
  const channel = await finished("channel-followup");
  assert.deepEqual(channel.context.spec.filters.channels, ["FaceBoom"]);
  await page.getByRole("button", { name: "7-day window", exact: true }).click();
  const seven = await finished("seven-day-followup");
  assert.equal(seven.context.spec.windowDays, 7);
  assert.deepEqual(seven.context.spec.filters.channels, ["FaceBoom"]);
  await page
    .getByRole("button", { name: "Remember 7-day window", exact: true })
    .click();
  await page
    .getByRole("status")
    .getByText(/Saved a 7-day default window/)
    .waitFor();
  await page
    .getByRole("button", { name: "14-day window", exact: true })
    .click();
  assert.equal(
    (await finished("temporary-fourteen-day")).context.spec.windowDays,
    14,
  );
  await page
    .getByRole("button", { name: "Start from saved defaults", exact: true })
    .click();
  const restored = await finished("source-backed-memory-default");
  assert.equal(restored.context.spec.windowDays, 7);
  assert.deepEqual(restored.context.spec.filters.channels, []);
  assert.ok(restored.events.some((e) => e.type === "memory_recalled"));
  checks.savedDefaultRestored = true;
  const actions = restored.answer?.followups ?? [];
  if (actions.length) {
    await page
      .getByRole("button", { name: actions[0].label, exact: false })
      .click();
    const followup = await finished("recommended-followup");
    assert.deepEqual(followup.context.spec.periods, actions[0].patch.periods);
    checks.recommendationExecuted = true;
  } else {
    throw new Error("Expected an executable followup recommendation");
  }
  await send("Show new-user revenue for July 2019 (cancel test)");
  await page.waitForFunction((previous) => {
    const state = document.querySelector<HTMLElement>(
      '[data-testid="run-state"]',
    );
    return (
      state?.dataset.runId !== previous &&
      ["queued", "running"].includes(state?.dataset.status ?? "")
    );
  }, previous);
  await page
    .getByRole("button", { name: "Cancel investigation", exact: true })
    .click();
  await finished("cancelled-run", ["cancelled"]);
  assert.equal(await page.getByTestId("report").count(), 0);
  checks.cancelDoesNotLeaveOldReport = true;
  await send("Why did FaceBoom ad CTR fall in July 2019?");
  await finished("missing-click-data", ["unsupported"]);
  assert.equal(await page.getByTestId("report").count(), 0);
  checks.unsupportedDoesNotLeaveOldReport = true;
  if (!live) {
    await page.route("**/runs/*/events*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": test transport closed\n\n",
      }),
    );
    await send("Show new-user revenue for July 2019");
    await finished("polling-without-sse");
    checks.pollingCompletesWithoutSse = true;
    await page.unroute("**/runs/*/events*");
    await send("test model offline");
    const failed = await finished("injected-model-offline", ["failed"]);
    assert.equal(failed.error?.code, "MODEL_OFFLINE");
    assert.equal(await page.getByTestId("report").count(), 0);
    checks.failedDoesNotLeaveOldReport = true;
    await page.route("**/conversations/*/messages", (route) =>
      route.fulfill({
        status: 202,
        contentType: "text/plain",
        body: "unreadable test response",
      }),
    );
    await send("Show revenue for July 2019");
    await page
      .getByRole("alert")
      .getByText(/Submission status is unconfirmed/)
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Investigate", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(await page.getByTestId("report").count(), 0);
    await page.unroute("**/conversations/*/messages");
    const beforeRecovery = await (
      await page.request.get(
        `${apiRoot}/api/v1/conversations/${main.conversationId}`,
      )
    ).json();
    await page
      .getByRole("button", { name: "Restore session", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !(document.querySelector('button[type="submit"]') as HTMLButtonElement)
          ?.disabled,
    );
    const afterRecovery = await (
      await page.request.get(
        `${apiRoot}/api/v1/conversations/${main.conversationId}`,
      )
    ).json();
    assert.equal(afterRecovery.runIds.length, beforeRecovery.runIds.length);
    checks.ambiguousPostRequiresRestoreWithoutResubmit = true;
    await page
      .getByRole("button", {
        name: "Explore a sample investigation",
        exact: true,
      })
      .click();
    await page.getByText("Sample", { exact: true }).waitFor();
    await page.getByTestId("report").waitFor();
    checks.explicitFixtureReplay = true;
    // Exercise all three renderers and null/negative semantics using a clearly synthetic payload.
    const demoResponse = await page.request.get(`${apiRoot}/api/v1/demo`),
      demo = await demoResponse.json();
    const original = demo.answer.charts[0] as Chart;
    const sample = (type: Chart["type"]) => ({
      ...original,
      id: `test-${type}`,
      type,
      series: [0, 1].map((si) => {
        const s = original.series[si % original.series.length];
        return {
          ...s,
          id: `test-series-${si}`,
          points: [0, 1, 2].map((i) => ({
            ...s.points[0],
            key: `test-key-${i}`,
            label: `2019-07-0${i + 1}`,
            value: i === 1 ? null : si === 0 ? -5 : 10,
            bucket: `2019-07-0${i + 1}`,
          })),
        };
      }),
    });
    await page
      .getByRole("button", { name: "Return to investigation", exact: true })
      .click();
    await page.route("**/api/v1/demo", (route) =>
      route.fulfill({
        json: {
          ...demo,
          answer: {
            ...demo.answer,
            charts: [sample("line"), sample("stacked_bar")],
          },
        },
      }),
    );
    await page
      .getByRole("button", {
        name: "Explore a sample investigation",
        exact: true,
      })
      .click();
    await page.locator('[data-chart-id="test-line"]').waitFor();
    const line = page.locator('[data-chart-id="test-line"]');
    assert.equal(
      await line
        .locator("svg path")
        .first()
        .getAttribute("d")
        .then((v) => (v?.match(/M/g) ?? []).length),
      2,
    );
    assert.equal(await line.locator("svg [data-value]").count(), 4);
    checks.lineNullBreaksAndNegativePoints = true;
    assert.equal(
      await page
        .locator('[data-chart-id="test-stacked_bar"] svg [data-value]')
        .count(),
      4,
    );
    checks.stackedBarRendered = true;
    await page.unroute("**/api/v1/demo");
    for (const [grain, dates] of [
      ["day", ["2019-07-01", "2019-07-03", "2019-07-04"]],
      ["week", ["2019-12-23", "2020-01-06", "2020-01-13"]],
      ["month", ["2019-12-01", "2020-02-01", "2020-03-01"]],
    ] as const) {
      const base = sample("line");
      const gapChart = {
        ...base,
        id: `test-gap-${grain}`,
        source: {
          ...base.source,
          spec: { ...base.source.spec, mode: "calendar", timeGrain: grain },
        },
        series: base.series.map((series) => ({
          ...series,
          points: series.points.map((point, i) => ({
            ...point,
            key: dates[i],
            label: dates[i],
            bucket: dates[i],
            value: 10 + i,
          })),
        })),
      };
      await page.route("**/api/v1/demo", (route) =>
        route.fulfill({
          json: { ...demo, answer: { ...demo.answer, charts: [gapChart] } },
        }),
      );
      await page
        .getByRole("button", { name: "Return to investigation", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Explore a sample investigation",
          exact: true,
        })
        .click();
      const plot = page.locator(`[data-chart-id="test-gap-${grain}"]`);
      await plot.waitFor();
      assert.equal(
        await plot
          .locator("svg path")
          .first()
          .getAttribute("d")
          .then((d) => (d?.match(/M/g) ?? []).length),
        2,
        `${grain} missing bucket must break the line`,
      );
      await page.unroute("**/api/v1/demo");
    }
    checks.missingDayWeekMonthBucketsBreakLines = true;
    checks.syntheticRendererChecksSeparateFromSourceBinding = true;
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  checks.mobileNoDocumentOverflow = true;
  assert.doesNotMatch(
    (await page.locator("body").innerText()).replace(question, ""),
    /[\u3400-\u9fff]/u,
    "Rendered mobile UI exposed non-English text",
  );
  checks.englishOnlyUserFacingText = true;
  await page.screenshot({
    path: `evidence/fallback-ui-${mode}-mobile.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    `evidence/fallback-ui-${mode}.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        kind: "actual_react_fallback_ui",
        mode: live
          ? "live_zetaris_nightshift_nvidia"
          : "self_authored_fixture_and_scripted_model",
        pass: true,
        checks,
        consoleErrors: errors,
        records,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ pass: true, mode, checks }));
} catch (error) {
  await page.screenshot({
    path: `evidence/fallback-ui-${mode}-failure.png`,
    fullPage: true,
  });
  await fs.writeFile(
    `evidence/fallback-ui-${mode}-development.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        pass: false,
        checks,
        records,
        consoleErrors: errors,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  await browser.close();
  await web.close();
  await backend.app.close();
  await fixture?.close();
}
