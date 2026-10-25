import { ZetarisBackend } from "../apps/server/src/integrations/zetaris.ts";
import { settings } from "../apps/server/src/config.ts";
import fs from "node:fs/promises";
const backend = new ZetarisBackend();
if (!/^[\w-]{20,}$/.test(settings.readerPassword))
  throw new Error("Missing reader credential");
// Provisioning SQL contains a private password and is never saved in evidence.
let registered = false;
try {
  await backend.execute("SELECT COUNT(*) AS n FROM storewhy.costs");
  registered = true;
} catch (error) {
  if (error instanceof Error && error.message.includes("HTTP 401")) throw error;
}
if (registered)
  await backend.request("REFRESH DATASOURCE TABLES FROM storewhy");
else {
  try {
    await backend.request(
      `CREATE DATASOURCE storewhy OPTIONS (jdbcdriver "org.postgresql.Driver", jdbcurl "jdbc:postgresql://storewhy-data:5432/storewhy", username "storewhy_reader", password "${settings.readerPassword}", fetchsize "1000")`,
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.toLowerCase().includes("already exist")
    )
      throw error;
  }
  for (const table of [
    "visits",
    "purchases",
    "costs",
    "profiles",
    "purchase_facts",
  ]) {
    try {
      await backend.request(
        `REGISTER DATASOURCE TABLE "${table}" FROM storewhy`,
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.toLowerCase().includes("already exist")
      )
        throw error;
    }
  }
}
const evidence = [];
for (const table of [
  "visits",
  "purchases",
  "costs",
  "profiles",
  "purchase_facts",
]) {
  const sql = `SELECT COUNT(*) AS n FROM storewhy.${table}`;
  const result = await backend.execute(sql);
  console.log(table, JSON.stringify(result.rows));
  evidence.push({ sql, ...result });
}
await fs.mkdir("evidence", { recursive: true });
await fs.writeFile(
  "evidence/data-registration.json",
  JSON.stringify(
    { at: new Date().toISOString(), backend: "zetaris", queries: evidence },
    null,
    2,
  ),
);
