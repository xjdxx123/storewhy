import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build, preview, type PreviewServer } from "vite";
import { CONTRACT_VERSION } from "@storewhy/contracts";
import { SHARE_HEADER, remoteConfiguration } from "./lib/shared-backend.ts";
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
config({
  path: process.env.STOREWHY_REMOTE_CONFIG ?? ".env.remote.local",
  quiet: true,
});
let ui: PreviewServer | undefined,
  stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(code), 3000);
  timeout.unref();
  if (ui)
    await new Promise<void>((resolve) => {
      ui!.httpServer.close(() => resolve());
      if ("closeAllConnections" in ui!.httpServer)
        ui!.httpServer.closeAllConnections();
    });
  clearTimeout(timeout);
  process.exit(code);
}
process.once("SIGINT", () => {
  void stop(0);
});
process.once("SIGTERM", () => {
  void stop(0);
});
try {
  const remote = remoteConfiguration(process.env);
  console.log("[1/2] 正在连接共享后端…");
  const response = await fetch(remote.target + "/healthz", {
    headers: { [SHARE_HEADER]: remote.token },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "访问口令无效或分享已结束，请重新取得连接文件。"
        : "共享后端暂不可用，请确认维护者仍在运行分享。",
    );
  const health = await response.json();
  if (health.apiVersion !== CONTRACT_VERSION || health.dataMode !== "zetaris")
    throw new Error("共享后端版本不匹配或未使用 Zetaris，请双方同步仓库版本。");
  process.env.STOREWHY_API_TARGET = remote.target;
  process.env.STOREWHY_SHARE_TOKEN = remote.token;
  // Quick Tunnels do not support SSE. Poll the existing Run instead, without resubmitting.
  process.env.VITE_STOREWHY_POLL_ONLY = "true";
  console.log("[2/2] 正在构建本机 UI…");
  const options = {
    root: path.join(root, "apps/fallback-web"),
    configFile: path.join(root, "apps/fallback-web/vite.config.ts"),
    logLevel: "warn" as const,
  };
  await build(options);
  ui = await preview({
    ...options,
    preview: { host: "127.0.0.1", port: remote.port, strictPort: true },
  });
  console.log(
    `\n只启动 UI，已连接远端 Live 后端：http://127.0.0.1:${remote.port}/`,
  );
  console.log(
    "本机不启动 Zetaris、Nightshift 或 API。Ctrl+C 只关闭本机 UI；录屏前先预跑一次 Why。\n",
  );
} catch (error) {
  let message = error instanceof Error ? error.message : "UI 启动失败";
  for (const key of [
    "STOREWHY_SHARE_TOKEN",
    "ZETARIS_API_KEY",
    "METERLESS_RUNTIME_TOKEN",
  ])
    if (process.env[key])
      message = message.split(process.env[key]!).join("[redacted]");
  console.error(
    message.includes("fetch failed")
      ? "无法连接共享后端，请检查网络，或让维护者重新启动分享。"
      : message.slice(0, 1000),
  );
  await stop(1);
}
