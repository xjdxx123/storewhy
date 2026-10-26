import { config } from "dotenv";
import { createServer } from "node:net";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build, preview, type PreviewServer } from "vite";
import { DEFAULT_SPEC } from "@storewhy/contracts";
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
config({ path: ".env.local", quiet: true });
// Recording is explicitly Live, regardless of the development default in .env.local.
process.env.STOREWHY_MODE = "live";
process.env.HOST = "127.0.0.1";
let backend:
  | Awaited<ReturnType<typeof import("../apps/server/src/app.ts").buildApp>>
  | undefined;
let ui: PreviewServer | undefined;
let stopping = false;
function port(value: string | undefined, fallback: number) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 65535)
    throw new Error(
      "端口必须为 1–65535 的整数，请检查 STOREWHY_DEMO_API_PORT / STOREWHY_DEMO_UI_PORT。",
    );
  return result;
}
async function free(port: number) {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () =>
      reject(
        new Error(
          `端口 ${port} 已占用。若已有服务可直接使用；否则先停止原进程，或配置其他端口。本命令不会关闭已有进程。`,
        ),
      ),
    );
    probe.listen({ host: "127.0.0.1", port }, () =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
function safe(error: unknown) {
  let text = error instanceof Error ? error.message : "启动失败";
  for (const key of [
    "ZETARIS_API_KEY",
    "METERLESS_RUNTIME_TOKEN",
    "STOREWHY_DB_PASSWORD",
    "STOREWHY_READER_PASSWORD",
  ])
    if (process.env[key])
      text = text.split(process.env[key]!).join("[redacted]");
  return text.slice(0, 1000);
}
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(code), 5000);
  deadline.unref();
  try {
    if (ui) {
      await new Promise<void>((resolve) => {
        ui!.httpServer.close(() => resolve());
        if ("closeAllConnections" in ui!.httpServer)
          ui!.httpServer.closeAllConnections();
      });
    }
    await backend?.app.close();
  } finally {
    clearTimeout(deadline);
    process.exit(code);
  }
}
process.once("SIGINT", () => {
  console.log("\n正在关闭本次启动的 UI 和后端…");
  void stop(0);
});
process.once("SIGTERM", () => {
  void stop(0);
});
try {
  const missing = ["ZETARIS_API_KEY", "METERLESS_RUNTIME_TOKEN"].filter(
    (key) => !process.env[key]?.trim(),
  );
  if (missing.length)
    throw new Error(
      `缺少 ${missing.join("、")}。请先在私有 .env.local 配置已可访问的 Zetaris 与 Nightshift，见 docs/recording.md；不要将凭证发到聊天或提交 Git。`,
    );
  await access(path.join(root, "data/manifests/procrastinate.json")).catch(
    () => {
      throw new Error(
        "缺少数据 manifest，请先执行 npm run data:prepare，并完成数据导入和 Zetaris 登记，见 docs/recording.md。",
      );
    },
  );
  const apiPort = port(
    process.env.STOREWHY_DEMO_API_PORT ?? process.env.PORT,
    3100,
  );
  const uiPort = port(process.env.STOREWHY_DEMO_UI_PORT, 5173);
  if (apiPort === uiPort) throw new Error("UI 与后端不能使用相同端口。");
  await free(apiPort);
  await free(uiPort);
  console.log("[1/4] 正在启动 Live 后端…");
  const { buildApp } = await import("../apps/server/src/app.ts");
  backend = await buildApp();
  await backend.app.listen({ host: "127.0.0.1", port: apiPort });
  console.log("[2/4] 正在检查 Zetaris 连接与 Nightshift 模型路由…");
  const result = await backend.app.inject({
    method: "GET",
    url: "/api/v1/integrations",
  });
  if (result.statusCode !== 200)
    throw new Error(
      "无法检查外部连接，请确认 Zetaris 和 Nightshift 已启动并完成授权。",
    );
  const integrations = result.json();
  if (
    integrations.data?.status !== "online" ||
    integrations.data?.backend !== "zetaris"
  )
    throw new Error(
      "Zetaris 未连接或未授权，请检查服务地址、API token 与组织配置。没有启动样例替代 Live。",
    );
  if (integrations.model?.status !== "online")
    throw new Error(
      "Nightshift 模型路由不可用，请启动 Nightshift，并检查 Runtime token、NVIDIA 连接与模型名称。没有启动样例替代 Live。",
    );
  console.log("[3/4] 正在通过 Zetaris 查询录屏主场景的数据…");
  const evidence = await backend.analytics.query(DEFAULT_SPEC);
  if (
    !evidence.rows.some(
      (row) => (row.values.new_users ?? 0) > 0 && (row.values.revenue ?? 0) > 0,
    )
  )
    throw new Error(
      "录屏主场景没有用户或收入数据，请先完成数据导入与 Zetaris 登记。",
    );
  console.log("[4/4] 正在构建并启动备用 React UI…");
  process.env.STOREWHY_API_TARGET = `http://127.0.0.1:${apiPort}`;
  const options = {
    root: path.join(root, "apps/fallback-web"),
    configFile: path.join(root, "apps/fallback-web/vite.config.ts"),
    logLevel: "warn" as const,
  };
  await build(options);
  if (stopping) throw new Error("启动已取消");
  ui = await preview({
    ...options,
    preview: { host: "127.0.0.1", port: uiPort, strictPort: true },
  });
  console.log(`\n录屏服务已就绪：http://127.0.0.1:${uiPort}/`);
  console.log(
    `Live API：http://127.0.0.1:${apiPort} · Zetaris + Nightshift/NVIDIA`,
  );
  console.log(
    "Zetaris 查询与 Nightshift 模型发现检查通过；正式录屏前请在页面预跑一次 Why。Ctrl+C 同时关闭本次启动的两个服务。\n",
  );
} catch (error) {
  console.error("\n未就绪：" + safe(error));
  await stop(1);
}
