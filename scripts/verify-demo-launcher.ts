import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import type { Run } from "@storewhy/contracts";
const records: unknown[] = [];
function launch(env: Record<string, string> = {}) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/start-demo.ts"],
    { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  return { child, exited, output: () => output };
}
async function until(
  check: () => boolean | Promise<boolean>,
  timeout = 120000,
) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Launcher verification timed out");
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
async function isFree(port: number) {
  const server = createServer();
  return new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
const dummy = {
  ZETARIS_API_KEY: "private-launcher-test-key",
  METERLESS_RUNTIME_TOKEN: "private-launcher-test-token",
};
async function rejected(
  name: string,
  env: Record<string, string>,
  expected: RegExp,
) {
  const run = launch(env);
  const timer = setTimeout(() => run.child.kill("SIGTERM"), 15000);
  try {
    assert.equal(await run.exited, 1);
    assert.match(run.output(), expected);
    for (const secret of Object.values(dummy))
      assert.ok(!run.output().includes(secret));
    records.push({ name, pass: true, exitCode: 1 });
  } finally {
    clearTimeout(timer);
    if (run.child.exitCode === null) run.child.kill("SIGKILL");
  }
}
await rejected(
  "missing-private-config",
  { ZETARIS_API_KEY: "", METERLESS_RUNTIME_TOKEN: "" },
  /缺少 ZETARIS_API_KEY、METERLESS_RUNTIME_TOKEN/,
);
await rejected(
  "invalid-port",
  { ...dummy, STOREWHY_DEMO_API_PORT: "0" },
  /1–65535/,
);
await rejected(
  "same-ports",
  { ...dummy, STOREWHY_DEMO_API_PORT: "13011", STOREWHY_DEMO_UI_PORT: "13011" },
  /不能使用相同端口/,
);
const held = createServer();
await new Promise<void>((resolve) => held.listen(0, "127.0.0.1", resolve));
const heldAddress = held.address();
assert.ok(heldAddress && typeof heldAddress !== "string");
const unused = await freePort();
try {
  await rejected(
    "occupied-ui-port-preserves-other-process",
    {
      ...dummy,
      STOREWHY_DEMO_API_PORT: String(unused),
      STOREWHY_DEMO_UI_PORT: String(heldAddress.port),
    },
    /已占用/,
  );
  assert.ok(held.listening);
  assert.ok(await isFree(unused));
} finally {
  await new Promise<void>((resolve) => held.close(() => resolve()));
}
const apiPort = await freePort(),
  uiPort = await freePort();
assert.notEqual(apiPort, uiPort);
const stateDir = mkdtempSync(path.join(tmpdir(), "storewhy-launcher-"));
const live = launch({
  STOREWHY_MODE: "fixture",
  STOREWHY_DEMO_API_PORT: String(apiPort),
  STOREWHY_DEMO_UI_PORT: String(uiPort),
  STOREWHY_STATE_DIR: stateDir,
});
const consoleErrors: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const deadline = setTimeout(() => live.child.kill("SIGKILL"), 240000);
try {
  await until(() => {
    if (live.child.exitCode !== null)
      throw new Error("Live startup failed: " + live.output());
    return live.output().includes("录屏服务已就绪");
  });
  const root = `http://127.0.0.1:${uiPort}`;
  const health = await (await fetch(root + "/healthz")).json();
  assert.equal(health.dataMode, "zetaris");
  assert.equal(health.apiVersion, "1.4.0");
  records.push({
    name: "one-command-live-api-ui-and-proxy",
    pass: true,
    forcedLiveDespiteFixtureDefault: true,
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
  page.setDefaultTimeout(180000);
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") consoleErrors.push(e.text());
  });
  await page.goto(root);
  await page.waitForFunction(
    () =>
      !(document.querySelector('button[type="submit"]') as HTMLButtonElement)
        ?.disabled,
  );
  await page
    .getByRole("button", { name: "Investigate →", exact: true })
    .click();
  await page.waitForFunction(() =>
    ["completed", "limited", "failed"].includes(
      document.querySelector<HTMLElement>('[data-testid="run-state"]')?.dataset
        .status ?? "",
    ),
  );
  const id = await page.getByTestId("run-state").getAttribute("data-run-id");
  const run = (await (
    await fetch(`http://127.0.0.1:${apiPort}/api/v1/runs/${id}`)
  ).json()) as Run;
  assert.ok(["completed", "limited"].includes(run.status), run.message);
  assert.ok(run.answer?.summary);
  assert.equal(run.context.taskKind, "why");
  assert.equal(run.context.spec.windowDays, 14);
  assert.equal(run.context.spec.audience, "paid");
  assert.ok(run.events.some((e) => e.type === "review_completed"));
  const evidence = new Map();
  for (const fact of run.answer.facts) {
    if (!evidence.has(fact.evidenceId))
      evidence.set(
        fact.evidenceId,
        await (
          await fetch(
            `http://127.0.0.1:${apiPort}/api/v1/evidence/${fact.evidenceId}`,
          )
        ).json(),
      );
    assert.equal(
      fact.value,
      evidence.get(fact.evidenceId).rows[fact.rowIndex].values[fact.metric],
    );
  }
  assert.ok(run.answer.facts.length > 0);
  assert.equal(await page.getByTestId("report").count(), 1);
  assert.ok(
    run.answer?.facts.every((f) => run.evidenceIds.includes(f.evidenceId)),
  );
  await page.screenshot({
    path: "evidence/demo-launcher-live.png",
    fullPage: true,
  });
  assert.deepEqual(consoleErrors, []);
  records.push({
    name: "live-why-from-built-ui",
    pass: true,
    runId: run.id,
    status: run.status,
    summary: run.answer?.summary,
    timing: run.timing,
  });
  // Keep an SSE connection and real task in flight to verify coordinated shutdown.
  await page
    .getByRole("button", { name: "Focus on FaceBoom", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel investigation", exact: true })
    .waitFor();
  live.child.kill("SIGINT");
  assert.equal(await live.exited, 0);
  await until(
    async () => (await isFree(apiPort)) && (await isFree(uiPort)),
    10000,
  );
  records.push({
    name: "ctrl-c-closes-both-ports-with-active-run",
    pass: true,
    exitCode: 0,
  });
  assert.ok(
    consoleErrors.every((error) =>
      /ERR_(CONNECTION_REFUSED|INCOMPLETE_CHUNKED_ENCODING|ABORTED)/.test(
        error,
      ),
    ),
    "Only intentional shutdown transport errors may occur after the earlier zero-error assertion",
  );
  await fs.writeFile(
    "evidence/demo-launcher-verification.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        pass: true,
        kind: "actual_one_command_startup_and_shutdown",
        records,
        consoleErrors,
        consoleErrorsDuringInvestigation: [],
        consoleErrorNote:
          "The investigation asserted zero browser errors before shutdown. Closing active SSE/API connections can produce the recorded transport errors after Ctrl+C.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ pass: true, checks: records.length }));
} catch (error) {
  await fs.writeFile(
    "evidence/demo-launcher-development.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        pass: false,
        records,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ) + "\n",
  );
  throw error;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  if (live.child.exitCode === null) {
    live.child.kill("SIGTERM");
    await live.exited;
  }
}
