import fs from "node:fs";
import path from "node:path";

import { validateEtfSnapshot, type EtfSnapshotLike } from "../src/lib/etf-quality";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const candidates = [
  { path: path.join(root, "src/data/etf-three-factor-complete-latest.json"), phase: "complete" as const },
  { path: path.join(root, "src/data/etf-three-factor-early-latest.json"), phase: "early" as const },
  { path: path.join(root, "src/data/etf-three-factor-latest.json"), phase: "auto" as const },
];

let checked = 0;
for (const candidate of candidates) {
  if (!fs.existsSync(candidate.path)) continue;
  const snapshot = JSON.parse(fs.readFileSync(candidate.path, "utf8")) as EtfSnapshotLike;
  const result = validateEtfSnapshot(snapshot, candidate.phase);
  console.log(`[etf-quality] ${path.basename(candidate.path)} ${result.status} ${JSON.stringify(result.metrics)}`);
  if (result.status !== "healthy") {
    console.error(`[etf-quality] errors: ${result.errors.join(", ")}`);
    process.exitCode = 1;
  }
  checked += 1;
}

if (checked === 0) {
  console.error("[etf-quality] no ETF snapshot found");
  process.exitCode = 1;
}
