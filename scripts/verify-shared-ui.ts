import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "dotenv";
import { chromium } from "@playwright/test";
import type { Evidence, Run } from "@storewhy/contracts";
import {
  createSharedRelay,
  SHARE_HEADER,
  remoteConfiguration,
} from "./lib/shared-backend.ts";
const publicMode = process.argv.includes("--public");
const suffix = publicMode ? "public" : "local";
const records: unknown[] = [];
const privateDir = mkdtempSync(path.join(tmpdir(), "storewhy-share-check-"));
let relay: ReturnType<typeof createSharedRelay> | undefined;
const token = randomBytes(32).toString("base64url");
let profile = process.env.STOREWHY_REMOTE_CONFIG ?? ".state/share/teammate.env";
if (!publicMode) {
  relay = createSharedRelay({
    target: process.env.STOREWHY_HTTP_URL ?? "http://127.0.0.1:3100",
    token,
    expiresAt: Date.now() + 15 * 60000,
  });
  await new Promise<void>((resolve) => relay!.listen(0, "127.0.0.1", resolve));
  const address = relay.address();
  assert.ok(address && typeof address !== "string");
  profile = path.join(privateDir, "connection.env");
  await fs.writeFile(
    profile,
    `STOREWHY_API_TARGET=http://127.0.0.1:${address.port}\nSTOREWHY_SHARE_TOKEN=${token}\n`,
    { mode: 0o600 },
  );
}
const remote = remoteConfiguration(parse(await fs.readFile(profile)));
async function until(check: () => boolean | Promise<boolean>, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Remote UI verification timed out");
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
function launch(config: string, port: number) {
  const env = {
    ...process.env,
    STOREWHY_REMOTE_CONFIG: config,
    STOREWHY_UI_PORT: String(port),
    ZETARIS_API_KEY: "",
    METERLESS_RUNTIME_TOKEN: "",
  };
  for (const key of [
    "STOREWHY_API_TARGET",
    "STOREWHY_SHARE_TOKEN",
    "STOREWHY_SHARE_EXPIRES_AT",
  ])
    delete env[key as keyof typeof env];
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/start-remote-ui.ts"],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  return { child, exited, output: () => output };
}
// Use dedicated files and no vendor configuration, as on the teammate's machine.
let live: ReturnType<typeof launch> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const noKey = await fetch(remote.target + "/healthz");
  const wrongKey = await fetch(remote.target + "/healthz", {
    headers: { [SHARE_HEADER]: "wrong" },
  });
  assert.equal(noKey.status, 401);
  assert.equal(wrongKey.status, 401);
  await noKey.body?.cancel();
  await wrongKey.body?.cancel();
  records.push({ name: "no-key-and-wrong-key-denied", pass: true });
  for (const [name, content, expected] of [
    ["missing-config", "", /缺少连接配置/],
    [
      "expired-config",
      `STOREWHY_API_TARGET=${remote.target}\nSTOREWHY_SHARE_TOKEN=${remote.token}\nSTOREWHY_SHARE_EXPIRES_AT=2000-01-01\n`,
      /已过期/,
    ],
    [
      "wrong-key",
      `STOREWHY_API_TARGET=${remote.target}\nSTOREWHY_SHARE_TOKEN=${"w".repeat(43)}\n`,
      /访问口令无效/,
    ],
  ] as const) {
    const file = path.join(privateDir, name + ".env");
    await fs.writeFile(file, content, { mode: 0o600 });
    const attempt = launch(file, await freePort());
    const timer = setTimeout(() => attempt.child.kill("SIGKILL"), 20000);
    try {
      assert.equal(await attempt.exited, 1);
      assert.match(attempt.output(), expected);
      assert.ok(!attempt.output().includes(remote.token));
      records.push({ name, pass: true });
    } finally {
      clearTimeout(timer);
    }
  }
  const port = await freePort();
  live = launch(path.resolve(profile), port);
  await until(() => {
    if (live!.child.exitCode !== null) throw new Error(live!.output());
    return live!.output().includes("只启动 UI，已连接远端 Live 后端");
  });
  const root = `http://127.0.0.1:${port}`;
  const health = await (await fetch(root + "/healthz")).json();
  assert.equal(health.dataMode, "zetaris");
  assert.equal(health.apiVersion, "1.4.0");
  const privateEnv = parse(await fs.readFile(".env.local"));
  const secrets = [
    remote.token,
    ...Object.entries(privateEnv)
      .filter(([key]) => /KEY|TOKEN|PASSWORD|SECRET/.test(key))
      .map(([, value]) => value),
  ].filter(Boolean);
  for (const file of await fs.readdir("apps/fallback-web/dist", {
    recursive: true,
  })) {
    const full = path.join("apps/fallback-web/dist", file);
    if (!(await fs.stat(full)).isFile()) continue;
    const content = await fs.readFile(full, "utf8");
    assert.ok(
      secrets.every((secret) => !content.includes(secret)),
      "Private value leaked into browser bundle",
    );
  }
  assert.ok(!live.output().includes(remote.token));
  records.push({
    name: "ui-only-without-vendor-config-and-secret-free-bundle",
    pass: true,
    health,
  });
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.STOREWHY_CHROME ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  page.setDefaultTimeout(240000);
  const browserErrors: string[] = [];
  let sseRequests = 0,
    runReads = 0,
    leakedHeader = false,
    previous = "";
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (/\/runs\/[^/]+\/events/.test(request.url())) sseRequests++;
    if (/\/runs\/[^/?]+$/.test(request.url()) && request.method() === "GET")
      runReads++;
    if (request.headers()[SHARE_HEADER]) leakedHeader = true;
  });
  async function finished() {
    await page.waitForFunction((previous) => {
      const state = document.querySelector<HTMLElement>(
        '[data-testid="run-state"]',
      );
      return (
        !!state?.dataset.runId &&
        state.dataset.runId !== previous &&
        ["completed", "limited", "failed", "unsupported"].includes(
          state.dataset.status ?? "",
        )
      );
    }, previous);
    const id = await page.getByTestId("run-state").getAttribute("data-run-id");
    const run = (await (
      await fetch(`${root}/api/v1/runs/${id}`)
    ).json()) as Run;
    assert.ok(["completed", "limited"].includes(run.status), run.message);
    assert.ok(run.answer?.summary);
    assert.ok(run.events.some((event) => event.type === "review_completed"));
    previous = run.id;
    return run;
  }
  await page.goto(root);
  await page.waitForFunction(
    () =>
      !(document.querySelector('button[type="submit"]') as HTMLButtonElement)
        ?.disabled,
  );
  await page
    .getByRole("button", { name: "Investigate →", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel investigation", exact: true })
    .waitFor();
  await page.reload();
  const main = await finished();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /\p{Script=Han}/u,
  );
  const conversation = await (
    await fetch(`${root}/api/v1/conversations/${main.conversationId}`)
  ).json();
  assert.equal(conversation.runIds.length, 1);
  const points = await page.locator("svg [data-value]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      evidenceId: node.getAttribute("data-evidence-id")!,
      rowIndex: Number(node.getAttribute("data-row-index")),
      metric: node.getAttribute("data-metric")!,
      value: Number(node.getAttribute("data-value")),
    })),
  );
  const expected = main.answer!.charts!.flatMap((chart) =>
    chart.series.flatMap((series) =>
      series.points.filter((point) => point.value !== null),
    ),
  );
  assert.equal(points.length, expected.length);
  assert.ok(points.length > 0);
  const evidence = new Map<string, Evidence>();
  for (const point of points) {
    if (!evidence.has(point.evidenceId))
      evidence.set(
        point.evidenceId,
        await (
          await fetch(`${root}/api/v1/evidence/${point.evidenceId}`)
        ).json(),
      );
    const row = evidence.get(point.evidenceId)!.rows[point.rowIndex];
    assert.equal(
      point.value,
      row.values[point.metric as keyof typeof row.values],
    );
  }
  await page
    .getByRole("button", { name: /^View source/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Query results", { exact: true }).waitFor();
  const sourceId = (await dialog.locator("p.mono").first().textContent())!;
  const displayedSource = (await (
    await fetch(`${root}/api/v1/evidence/${sourceId}`)
  ).json()) as Evidence;
  assert.equal(
    await dialog.locator("tbody tr").count(),
    displayedSource.rows.length,
  );
  assert.match((await dialog.textContent()) ?? "", /SELECT/);
  await page.keyboard.press("Escape");
  records.push({
    name: "consolidated-source-retains-all-query-rows-and-sql",
    pass: true,
    rows: displayedSource.rows.length,
  });
  await page.screenshot({
    path: `evidence/shared-ui-${suffix}.png`,
    fullPage: true,
  });
  records.push({
    name: "live-why-refresh-and-evidence-bound-charts",
    pass: true,
    runId: main.id,
    status: main.status,
    summary: main.answer?.summary,
    chartPoints: points.length,
    englishPresentation: true,
  });
  await page
    .getByRole("button", { name: "Focus on FaceBoom", exact: true })
    .click();
  const followup = await finished();
  assert.deepEqual(followup.context.spec.filters.channels, ["FaceBoom"]);
  assert.equal(followup.context.spec.windowDays, main.context.spec.windowDays);
  assert.ok(followup.evidenceIds.every((id) => !main.evidenceIds.includes(id)));
  assert.equal(sseRequests, 0);
  assert.ok(runReads >= 2);
  assert.equal(leakedHeader, false);
  assert.deepEqual(browserErrors, []);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  assert.ok(!storage.includes(remote.token));
  records.push({
    name: "followup-poll-only-and-server-side-token",
    pass: true,
    runId: followup.id,
    runReads,
    sseRequests,
    browserErrors,
  });
  await browser.close();
  browser = undefined;
  live.child.kill("SIGINT");
  assert.equal(await live.exited, 0);
  assert.equal(
    (
      await fetch(remote.target + "/healthz", {
        headers: { [SHARE_HEADER]: remote.token },
      })
    ).status,
    200,
  );
  records.push({ name: "ui-shutdown-preserves-shared-backend", pass: true });
  await fs.writeFile(
    `evidence/shared-ui-${suffix}.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        pass: true,
        transport: publicMode
          ? "actual_public_https_tunnel"
          : "loopback_protected_relay_only",
        publicTunnelVerified: publicMode,
        records,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      pass: true,
      checks: records.length,
      publicTunnelVerified: publicMode,
    }),
  );
} catch (error) {
  let message = error instanceof Error ? error.message : String(error);
  message = message.split(remote.token).join("[redacted]");
  await fs.writeFile(
    `evidence/shared-ui-${suffix}-development.json`,
    JSON.stringify(
      { at: new Date().toISOString(), pass: false, records, error: message },
      null,
      2,
    ) + "\n",
  );
  throw new Error(message);
} finally {
  await browser?.close();
  if (live && live.child.exitCode === null && live.child.signalCode === null) {
    live.child.kill("SIGTERM");
    await live.exited;
  }
  if (relay)
    await new Promise<void>((resolve) => {
      relay!.close(() => resolve());
      relay!.closeAllConnections();
    });
}
