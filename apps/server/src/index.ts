import { buildApp } from "./app.ts";
import { settings, cleanError } from "./config.ts";
const { app } = await buildApp();
try {
  await app.listen({ port: settings.port, host: settings.host });
  console.log(
    `StoreWhy backend listening at http://${settings.host}:${settings.port} (${settings.mode})`,
  );
} catch (error) {
  console.error(cleanError(error));
  process.exitCode = 1;
}
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
