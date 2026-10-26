import { it, expect, vi, afterEach } from "vitest";
import { ZetarisBackend } from "../apps/server/src/integrations/zetaris.ts";
import { settings } from "../apps/server/src/config.ts";
const key = settings.zetarisKey;
afterEach(() => {
  settings.zetarisKey = key;
  vi.unstubAllGlobals();
});
function transport() {
  settings.zetarisKey = "test-only";
  let active = 0,
    peak = 0;
  const fetcher = vi.fn(async (_url, options) => {
    peak = Math.max(peak, ++active);
    try {
      await new Promise((r) => setTimeout(r, 25));
      options.signal.throwIfAborted();
      return new Response(JSON.stringify({ data: [{ ok: 1 }] }));
    } finally {
      active--;
    }
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, peak: () => peak };
}
it("shares a maximum of two in-flight SQL requests across backend instances", async () => {
  const t = transport(),
    a = new ZetarisBackend(),
    b = new ZetarisBackend();
  await Promise.all([
    a.execute("SELECT 1"),
    a.execute("SELECT 2"),
    b.execute("SELECT 3"),
    b.execute("SELECT 4"),
  ]);
  expect(t.peak()).toBe(2);
  expect(t.fetcher).toHaveBeenCalledTimes(4);
});
it("removes a cancelled queued request before HTTP dispatch and releases capacity", async () => {
  const t = transport(),
    a = new ZetarisBackend(),
    b = new ZetarisBackend();
  const first = a.execute("SELECT 1"),
    second = a.execute("SELECT 2"),
    controller = new AbortController();
  const queued = b.execute("SELECT 3", controller.signal);
  controller.abort();
  await expect(queued).rejects.toMatchObject({ name: "AbortError" });
  await Promise.all([first, second]);
  expect(t.fetcher).toHaveBeenCalledTimes(2);
  await b.execute("SELECT 4");
  expect(t.fetcher).toHaveBeenCalledTimes(3);
});
