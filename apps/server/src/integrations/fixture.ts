import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { SqlBackend, SqlResult } from "./zetaris.ts";
export class FixtureBackend implements SqlBackend {
  readonly kind = "fixture" as const;
  readonly db = new PGlite();
  async initialize() {
    await this.db.exec(await fs.readFile("infra/schema.sql", "utf8"));
    await this.db.exec(
      `CREATE OR REPLACE FUNCTION unix_timestamp(t TIMESTAMP) RETURNS BIGINT AS $$ SELECT FLOOR(EXTRACT(EPOCH FROM t))::BIGINT $$ LANGUAGE SQL IMMUTABLE;`,
    );
    const fixture: {
      visits: string[][];
      purchases: string[][];
      costs: string[][];
    } = JSON.parse(await fs.readFile("data/fixtures/sample.json", "utf8"));
    for (const v of fixture.visits)
      await this.db.query(
        "INSERT INTO visits(user_id,region,device,channel,started_at,ended_at) VALUES($1,$2,$3,$4,$5,$6)",
        v,
      );
    for (const p of fixture.purchases)
      await this.db.query(
        "INSERT INTO purchases(user_id,purchased_at,amount) VALUES($1,$2,$3)",
        p,
      );
    for (const c of fixture.costs)
      await this.db.query(
        "INSERT INTO costs(cost_date,channel,amount) VALUES($1,$2,$3)",
        c,
      );
    await this.db.exec(await fs.readFile("infra/derived.sql", "utf8"));
  }
  async execute(sql: string, _signal?: AbortSignal): Promise<SqlResult> {
    const result = await this.db.query<Record<string, unknown>>(sql);
    return { rows: result.rows, queryId: "fixture-" + randomUUID() };
  }
  async close() {
    await this.db.close();
  }
}
