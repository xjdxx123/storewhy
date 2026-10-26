import { describe, test, expect } from "vitest";
import { createServer, type Server } from "node:http";
import {
  createSharedRelay,
  remoteConfiguration,
  SHARE_HEADER,
} from "../scripts/lib/shared-backend.ts";
const token = "shared-test-token-with-at-least-32-characters";
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
describe("temporary shared backend", () => {
  test("requires access key before forwarding, restricts routes, strips credentials and forwards body", async () => {
    const received: {
      url?: string;
      method?: string;
      key?: string | string[];
      auth?: string | string[];
      body: string;
    }[] = [];
    const upstream = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        received.push({
          url: req.url,
          method: req.method,
          key: req.headers[SHARE_HEADER],
          auth: req.headers.authorization,
          body,
        });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      });
    });
    const target = await listen(upstream),
      relay = createSharedRelay({
        target,
        token,
        expiresAt: Date.now() + 10000,
      }),
      root = await listen(relay);
    try {
      expect((await fetch(root + "/healthz")).status).toBe(401);
      expect(
        (
          await fetch(root + "/api/v1/conversations", {
            method: "POST",
            headers: { [SHARE_HEADER]: "wrong" },
          })
        ).status,
      ).toBe(401);
      expect(received).toHaveLength(0);
      const headers = {
        [SHARE_HEADER]: token,
        Authorization: "Bearer unrelated-client-credential",
        "content-type": "application/json",
      };
      expect(
        (await fetch(root + "/api/v1.0/sql-editor/sqls/run", { headers }))
          .status,
      ).toBe(404);
      expect(
        (
          await fetch(root + "/api/v1/conversations", {
            method: "DELETE",
            headers,
          })
        ).status,
      ).toBe(405);
      expect(received).toHaveLength(0);
      const response = await fetch(root + "/api/v1/conversations?from=ui", {
        method: "POST",
        headers,
        body: '{"message":"why"}',
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(received).toEqual([
        {
          url: "/api/v1/conversations?from=ui",
          method: "POST",
          key: undefined,
          auth: undefined,
          body: '{"message":"why"}',
        },
      ]);
    } finally {
      await close(relay);
      await close(upstream);
    }
  });
  test("expires without forwarding and rejects an unavailable origin without fallback", async () => {
    const expired = createSharedRelay({
        target: "http://127.0.0.1:1",
        token,
        expiresAt: 0,
      }),
      a = await listen(expired);
    const offline = createSharedRelay({
        target: "http://127.0.0.1:1",
        token,
        expiresAt: Date.now() + 10000,
      }),
      b = await listen(offline);
    try {
      const response = await fetch(a + "/healthz", {
        headers: { [SHARE_HEADER]: token },
      });
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("SHARE_EXPIRED");
      const failure = await fetch(b + "/healthz", {
        headers: { [SHARE_HEADER]: token },
      });
      expect(failure.status).toBe(502);
      expect((await failure.json()).error.code).toBe("SHARED_BACKEND_OFFLINE");
    } finally {
      await close(expired);
      await close(offline);
    }
  });
  test("never proxies to an external, credentialed or path-scoped origin", () => {
    for (const target of [
      "http://example.com",
      "http://user:pass@127.0.0.1",
      "http://127.0.0.1/api",
    ])
      expect(() =>
        createSharedRelay({ target, token, expiresAt: Date.now() + 10000 }),
      ).toThrow();
    expect(() =>
      createSharedRelay({
        target: "http://127.0.0.1",
        token: "short",
        expiresAt: 1,
      }),
    ).toThrow();
  });
  test("UI profile validates HTTPS, separate key, expiry and local UI port", () => {
    expect(
      remoteConfiguration({
        STOREWHY_API_TARGET: "https://example.trycloudflare.com",
        STOREWHY_SHARE_TOKEN: token,
      }),
    ).toEqual({
      target: "https://example.trycloudflare.com",
      token,
      port: 5173,
    });
    for (const env of [
      {},
      { STOREWHY_API_TARGET: "https://example.com" },
      {
        STOREWHY_API_TARGET: "http://example.com",
        STOREWHY_SHARE_TOKEN: token,
      },
      {
        STOREWHY_API_TARGET: "https://user:pass@example.com",
        STOREWHY_SHARE_TOKEN: token,
      },
      {
        STOREWHY_API_TARGET: "https://example.com",
        STOREWHY_SHARE_TOKEN: token,
        STOREWHY_SHARE_EXPIRES_AT: "2000-01-01",
      },
      {
        STOREWHY_API_TARGET: "https://example.com",
        STOREWHY_SHARE_TOKEN: token,
        STOREWHY_UI_PORT: "0",
      },
    ])
      expect(() => remoteConfiguration(env)).toThrow();
  });
});
