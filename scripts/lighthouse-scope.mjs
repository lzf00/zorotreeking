#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const GENERATED_SNAPSHOT_PATHS = [
  /^src\/data\/etf-three-factor-(?:early-latest|complete-latest|latest|status)\.json$/,
  /^src\/data\/wind-(?:market-latest|hk-market-latest|stock-details)\.json$/,
];

export function shouldRunLighthouse(paths) {
  const changed = paths.map((path) => path.trim()).filter(Boolean);
  if (changed.length === 0) return true;
  return changed.some((path) =>
    !GENERATED_SNAPSHOT_PATHS.some((pattern) => pattern.test(path)),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = readFileSync(0, "utf8").split("\n");
  process.stdout.write(shouldRunLighthouse(paths) ? "run\n" : "skip\n");
}
