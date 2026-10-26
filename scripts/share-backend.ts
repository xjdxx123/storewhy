import { config, parse } from "dotenv";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CONTRACT_VERSION } from "@storewhy/contracts";
import { createSharedRelay, SHARE_HEADER } from "./lib/shared-backend.ts";
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
config({ path: ".env.local", quiet: true });
const dir = path.join(root, ".state/share"),
  profile = path.join(dir, "teammate.env");
const log = path.join(dir, "cloudflared.log"),
  meta = path.join(dir, "session.json");
const target = process.env.STOREWHY_HTTP_URL ?? "http://127.0.0.1:3100";
const lifetime = 120 * 60000,
  token = randomBytes(32).toString("base64url"),
  expiresAt = Date.now() + lifetime;
let relay: ReturnType<typeof createSharedRelay> | undefined,
  child: ChildProcess | undefined,
  stopping = false,
  wroteProfile = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => {
    child?.kill("SIGKILL");
    process.exit(code);
  }, 5000);
  timeout.unref();
  const exited =
    child && child.exitCode === null && child.signalCode === null
      ? new Promise<void>((resolve) => {
          child!.once("exit", () => resolve());
          child!.kill("SIGTERM");
        })
      : Promise.resolve();
  if (relay?.listening)
    await new Promise<void>((resolve) => {
      relay!.close(() => resolve());
      relay!.closeAllConnections();
    });
  if (wroteProfile) {
    fs.writeFileSync(
      profile,
      `# 本次分享已结束，请重新运行 npm run share:backend\nSTOREWHY_SHARE_EXPIRES_AT=${new Date().toISOString()}\n`,
      { mode: 0o600 },
    );
    fs.writeFileSync(
      meta,
      JSON.stringify(
        { active: false, stoppedAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  }
  await exited;
  clearTimeout(timeout);
  console.log("本次分享已关闭；原后端、Zetaris 与 Nightshift 保持运行。");
  process.exit(code);
}
process.once("SIGINT", () => {
  void stop(0);
});
process.once("SIGTERM", () => {
  void stop(0);
});
try {
  console.log("[1/3] 正在检查现有 Live 后端…");
  const healthResponse = await fetch(target + "/healthz", {
    signal: AbortSignal.timeout(10000),
  });
  if (!healthResponse.ok)
    throw new Error("后端尚未运行，请先启动已有的 Live 后端。");
  const health = await healthResponse.json();
  if (health.apiVersion !== CONTRACT_VERSION || health.dataMode !== "zetaris")
    throw new Error("后端版本不匹配或不是 Zetaris Live 模式。");
  relay = createSharedRelay({ target, token, expiresAt });
  await new Promise<void>((resolve, reject) => {
    relay!.once("error", reject);
    relay!.listen(3199, "127.0.0.1", resolve);
  });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(log, "", { mode: 0o600 });
  fs.chmodSync(log, 0o600);
  const local = path.join(root, ".state/bin/cloudflared");
  const binary =
    process.env.CLOUDFLARED_BIN ??
    (fs.existsSync(local) ? local : "cloudflared");
  console.log("[2/3] 正在建立带口令保护的临时 HTTPS 连接…");
  child = spawn(
    binary,
    [
      "tunnel",
      "--url",
      "http://127.0.0.1:3199",
      "--no-autoupdate",
      "--loglevel",
      "info",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const tunnel = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            "隧道建立超时，请检查网络；诊断在 .state/share/cloudflared.log。",
          ),
        ),
      45000,
    );
    let output = "";
    const accept = (chunk: Buffer) => {
      fs.appendFileSync(log, chunk, { mode: 0o600 });
      output = (output + chunk.toString()).slice(-16000);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };
    child!.stdout!.on("data", accept);
    child!.stderr!.on("data", accept);
    child!.once("error", () => {
      clearTimeout(timeout);
      reject(
        new Error(
          "找不到 cloudflared，请安装官方客户端，或设置 CLOUDFLARED_BIN。",
        ),
      );
    });
    child!.once("exit", () => {
      clearTimeout(timeout);
      reject(
        new Error("临时隧道已退出，诊断在 .state/share/cloudflared.log。"),
      );
    });
  });
  console.log(
    "[3/3] 正在从 HTTPS 地址验证访问口令（新域名解析最多等待 3 分钟）…",
  );
  let ready = false;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("临时隧道已退出，请检查 .state/share/cloudflared.log。");
    try {
      const anonymous = await fetch(tunnel + "/healthz", {
        signal: AbortSignal.timeout(5000),
      });
      await anonymous.body?.cancel();
      const authorized = await fetch(tunnel + "/healthz", {
        headers: { [SHARE_HEADER]: token },
        signal: AbortSignal.timeout(5000),
      });
      const reply = authorized.ok ? await authorized.json() : null;
      if (
        anonymous.status === 401 &&
        reply?.dataMode === "zetaris" &&
        reply.apiVersion === CONTRACT_VERSION
      ) {
        ready = true;
        break;
      }
    } catch {
      /* The edge can take a few seconds to become available. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready)
    throw new Error(
      "隧道地址尚未通过认证检查，未生成连接配置，请检查网络后重试。",
    );
  fs.writeFileSync(
    profile,
    `# 临时连接口令，请仅私下发给需要录屏的队友\nSTOREWHY_API_TARGET=${tunnel}\nSTOREWHY_SHARE_TOKEN=${token}\nSTOREWHY_SHARE_EXPIRES_AT=${new Date(expiresAt).toISOString()}\n`,
    { mode: 0o600 },
  );
  fs.chmodSync(profile, 0o600);
  wroteProfile = true;
  fs.writeFileSync(
    meta,
    JSON.stringify(
      {
        active: true,
        pid: process.pid,
        target,
        tunnel,
        profile,
        expiresAt: new Date(expiresAt).toISOString(),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(`\n共享连接已就绪，有效 120 分钟。私有连接文件：${profile}`);
  console.log(
    "把该文件私下发给队友，保存为仓库根目录 .env.remote.local，再运行 npm run demo:ui。",
  );
  console.log(
    "无需复制供应商密钥。保持本终端、后端和电脑唤醒；Ctrl+C 立即结束分享。\n",
  );
  child.once("exit", () => {
    if (!stopping) {
      console.error("共享隧道已断开，请重新运行 npm run share:backend。");
      void stop(1);
    }
  });
  setTimeout(
    () => {
      console.log("临时分享已到期。");
      void stop(0);
    },
    Math.max(0, expiresAt - Date.now()),
  ).unref();
} catch (error) {
  let message = error instanceof Error ? error.message : "分享启动失败";
  const env = fs.existsSync(".env.local")
    ? parse(fs.readFileSync(".env.local"))
    : {};
  for (const value of [
    token,
    ...Object.entries(env)
      .filter(([key]) => /KEY|TOKEN|PASSWORD|SECRET/.test(key))
      .map(([, value]) => value),
  ])
    if (value) message = message.split(value).join("[redacted]");
  console.error(
    message.includes("fetch failed")
      ? "无法连接现有后端，请确认 Live API 已在本机运行。"
      : message.slice(0, 800),
  );
  await stop(1);
}
