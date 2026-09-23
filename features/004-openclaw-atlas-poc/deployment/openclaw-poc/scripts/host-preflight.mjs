import { spawnSync } from "node:child_process";

import { createHostPreflightReport } from "../dist/host-preflight.mjs";

const versionCheck = spawnSync("openclaw", ["--version"], {
  encoding: "utf8",
  timeout: 5_000,
});
const openClawVersion = versionCheck.status === 0 ? versionCheck.stdout.trim() : "";

let sqliteAvailable = false;
try {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE preflight(value TEXT); INSERT INTO preflight VALUES ('ok');");
  sqliteAvailable = database.prepare("SELECT value FROM preflight").get()?.value === "ok";
  database.close();
} catch {
  sqliteAvailable = false;
}

const report = createHostPreflightReport({
  nodeVersion: process.versions.node,
  openClawVersion,
  sqliteAvailable,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
