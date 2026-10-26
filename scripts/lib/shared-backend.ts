import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
export const SHARE_HEADER = "x-storewhy-access-key";
const hopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
function json(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(
    JSON.stringify({ error: { code, message, retryable: status >= 500 } }),
  );
}
function forwardHeaders(headers: IncomingHttpHeaders) {
  const result = { ...headers };
  for (const name of hopHeaders) delete result[name];
  delete result[SHARE_HEADER];
  delete result.authorization;
  delete result.cookie;
  return result;
}
export function createSharedRelay({
  target,
  token,
  expiresAt,
  now = Date.now,
}: {
  target: string;
  token: string;
  expiresAt: number;
  now?: () => number;
}) {
  const origin = new URL(target);
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("共享目标必须是本机 HTTP API 根地址。");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token))
    throw new Error("共享访问口令格式不符合要求。");
  const expected = Buffer.from(token);
  return createServer((req, res) => {
    const supplied = req.headers[SHARE_HEADER];
    if (now() >= expiresAt) {
      json(res, 401, "SHARE_EXPIRED", "本次分享已结束，请获取新的连接配置。");
      return;
    }
    if (
      typeof supplied !== "string" ||
      Buffer.byteLength(supplied) !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied), expected)
    ) {
      json(res, 401, "SHARE_UNAUTHORIZED", "缺少有效的分享访问口令。");
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://relay.local");
    } catch {
      json(res, 400, "INVALID_URL", "请求地址格式不正确。");
      return;
    }
    if (url.pathname !== "/healthz" && !url.pathname.startsWith("/api/v1/")) {
      json(res, 404, "NOT_FOUND", "此分享仅提供 StoreWhy API。");
      return;
    }
    if (!["GET", "POST", "OPTIONS"].includes(req.method ?? "")) {
      json(res, 405, "METHOD_NOT_ALLOWED", "此请求方法不可用。");
      return;
    }
    const upstream = request(
      origin,
      {
        method: req.method,
        path: url.pathname + url.search,
        headers: { ...forwardHeaders(req.headers), host: origin.host },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, {
          ...forwardHeaders(response.headers),
          "cache-control": "no-store",
        });
        response.pipe(res);
        response.on("error", () => res.destroy());
      },
    );
    upstream.setTimeout(120000, () =>
      upstream.destroy(new Error("upstream timeout")),
    );
    upstream.on("error", () => {
      if (!res.headersSent)
        json(
          res,
          502,
          "SHARED_BACKEND_OFFLINE",
          "共享后端暂时无法连接，请联系后端维护者。",
        );
      else res.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });
    req.pipe(upstream);
  });
}
export function remoteConfiguration(env: Record<string, string | undefined>) {
  const target = env.STOREWHY_API_TARGET;
  if (!target)
    throw new Error(
      "缺少连接配置，请把收到的 teammate.env 保存为仓库根目录 .env.remote.local。",
    );
  const url = new URL(target);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("远端 API 必须使用 HTTPS 根地址，且不能在 URL 中放口令。");
  const token = env.STOREWHY_SHARE_TOKEN;
  if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token))
    throw new Error("分享访问口令缺失或格式不正确，请重新取得连接文件。");
  if (env.STOREWHY_SHARE_EXPIRES_AT) {
    const expiry = Date.parse(env.STOREWHY_SHARE_EXPIRES_AT);
    if (!Number.isFinite(expiry) || expiry <= Date.now())
      throw new Error("连接文件已过期，请取得新的分享配置。");
  }
  const port = Number(env.STOREWHY_UI_PORT ?? 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("UI 端口必须为 1–65535。");
  return { target: url.origin, token, port };
}
