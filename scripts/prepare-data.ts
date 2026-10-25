import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
const files = [
  [
    "visits_info_short.csv",
    "c56826b20411f3873b6d2bb2e3f54a4e280be71fbec819034d6293d2dafd4b37",
    309901,
  ],
  [
    "orders_info_short.csv",
    "81cab4d4ed23799e54c7a2402860303cac7f337ec0b4b571ee041ccc18943e02",
    40212,
  ],
  [
    "costs_info_short.csv",
    "cfe2f3329c221199a2d5f3379989a7240a505731b73b5ea8115e583812a9e74c",
    1800,
  ],
] as const;
await fs.mkdir("data/raw", { recursive: true });
await fs.mkdir("data/manifests", { recursive: true });
const entries = [];
for (const [name, expectedSha, expectedRows] of files) {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile("data/raw/" + name);
  } catch {
    const response = await fetch(
      "https://code.s3.yandex.net/datasets/" + name,
      { signal: AbortSignal.timeout(90000) },
    );
    if (!response.ok) throw new Error("Download failed " + name);
    bytes = Buffer.from(await response.arrayBuffer());
    await fs.writeFile("data/raw/" + name, bytes);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expectedSha)
    throw new Error(
      "Source changed; inspect before updating pinned manifest: " + name,
    );
  const records: Record<string, string>[] = parse(bytes, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
  });
  if (records.length !== expectedRows)
    throw new Error("Row count mismatch " + name);
  entries.push({
    name,
    url: "https://code.s3.yandex.net/datasets/" + name,
    sha256,
    rows: records.length,
    columns: Object.keys(records[0]),
  });
  console.log(name, records.length, "verified");
}
const version = createHash("sha256")
  .update(entries.map((e) => e.sha256).join(":"))
  .digest("hex")
  .slice(0, 16);
await fs.writeFile(
  "data/manifests/procrastinate.json",
  JSON.stringify(
    {
      id: "procrastinate-pro-plus",
      version,
      kind: "public_teaching_sample",
      files: entries,
      observationEnd: "2019-11-01",
      acquisitionEnd: "2019-10-28",
      currency: "unspecified",
      timezone: "naive_source_time",
      redistributionLicense: "unconfirmed; raw files are not committed",
    },
    null,
    2,
  ) + "\n",
);
console.log("Dataset version", version);
