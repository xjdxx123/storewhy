import { config as dotenv } from "dotenv";
import path from "node:path";
dotenv({ path: ".env.local", quiet: true });
export const settings = {
  port: Number(process.env.PORT ?? 3100),
  host: process.env.HOST ?? "127.0.0.1",
  mode: process.env.STOREWHY_MODE ?? "fixture",
  stateDir: path.resolve(process.env.STOREWHY_STATE_DIR ?? ".state"),
  zetarisUrl: process.env.ZETARIS_REST_URL ?? "http://localhost:8888/api/v1.0",
  zetarisKey: process.env.ZETARIS_API_KEY ?? "",
  orgId: process.env.ZETARIS_ORG_ID ?? "1",
  nightshiftUrl: (
    process.env.METERLESS_BASE_URL ?? "http://127.0.0.1:8088/v1"
  ).replace(/\/$/, ""),
  nightshiftToken: process.env.METERLESS_RUNTIME_TOKEN ?? "",
  model: process.env.METERLESS_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b",
  corsOrigins: (
    process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173"
  ).split(","),
  dbPort: Number(process.env.STOREWHY_DB_PORT ?? 55432),
  dbPassword: process.env.STOREWHY_DB_PASSWORD ?? "",
  readerPassword: process.env.STOREWHY_READER_PASSWORD ?? "",
};
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}
export function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  let safe = message;
  for (const secret of [
    settings.zetarisKey,
    settings.nightshiftToken,
    settings.dbPassword,
    settings.readerPassword,
  ])
    if (secret) safe = safe.split(secret).join("[redacted]");
  return safe.slice(0, 700);
}
