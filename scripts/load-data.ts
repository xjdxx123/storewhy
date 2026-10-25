import "../apps/server/src/config.ts";
import { settings } from "../apps/server/src/config.ts";
import pg from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { pipeline } from "node:stream/promises";
import fs from "node:fs";
const client = new pg.Client({
  host: "127.0.0.1",
  port: settings.dbPort,
  user: "storewhy",
  password: settings.dbPassword,
  database: "storewhy",
});
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(fs.readFileSync("infra/schema.sql", "utf8"));
  const sources = [
    [
      "visits",
      "user_id,region,device,channel,started_at,ended_at",
      "visits_info_short.csv",
      309901,
    ],
    [
      "purchases",
      "user_id,purchased_at,amount",
      "orders_info_short.csv",
      40212,
    ],
    ["costs", "cost_date,channel,amount", "costs_info_short.csv", 1800],
  ] as const;
  for (const [table, cols, file, expected] of sources) {
    const { rows } = await client.query("SELECT COUNT(*) AS n FROM " + table);
    const n = Number(rows[0].n);
    if (n === 0)
      await pipeline(
        fs.createReadStream("data/raw/" + file),
        client.query(
          copyFrom(
            `COPY ${table}(${cols}) FROM STDIN WITH (FORMAT csv,HEADER true)`,
          ),
        ),
      );
    else if (n !== expected)
      throw new Error("Existing partial dataset; refusing to replace " + table);
    console.log(
      table,
      (await client.query("SELECT COUNT(*) AS n FROM " + table)).rows[0].n,
    );
  }
  await client.query(fs.readFileSync("infra/derived.sql", "utf8"));
  if (!/^[\w-]{20,}$/.test(settings.readerPassword))
    throw new Error("Generate a safe reader password in .env.local");
  await client.query(
    `DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='storewhy_reader') THEN CREATE ROLE storewhy_reader LOGIN PASSWORD '${settings.readerPassword}'; END IF; END $$; GRANT CONNECT ON DATABASE storewhy TO storewhy_reader; GRANT USAGE ON SCHEMA public TO storewhy_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO storewhy_reader;`,
  );
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
