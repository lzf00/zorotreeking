import assert from "node:assert/strict";
import test from "node:test";

import { ETF_CODES, ETF_REGISTRY, validateEtfSnapshot, type EtfSnapshotLike } from "../src/lib/etf-quality";

function completeSnapshot(): EtfSnapshotLike {
  const latest: NonNullable<EtfSnapshotLike["latest"]> = {};
  ETF_CODES.forEach((code, index) => {
    const vp = 20 + index;
    const dp = 30 + index;
    const sp = 40 + index;
    latest[code] = {
      d: "2026-08-03",
      vp,
      dp,
      sp,
      cp: Number((vp * 0.5 + dp * 0.2 + sp * 0.3).toFixed(1)),
      shares_yi: 100 + index,
      source_code: code,
      source_date: "2026-08-03",
    };
  });
  return { schema_version: 2, target_date: "2026-08-03", latest };
}

test("ETF registry is the canonical unique 12-code pool", () => {
  assert.equal(ETF_REGISTRY.expected_count, 12);
  assert.equal(new Set(ETF_CODES).size, 12);
});

test("complete ETF snapshot passes independent formula and identity validation", () => {
  const result = validateEtfSnapshot(completeSnapshot(), "complete");
  assert.equal(result.status, "healthy");
  assert.equal(result.metrics.shareCoverage, 12);
});

test("cross-contaminated share factors fail the publication gate", () => {
  const snapshot = completeSnapshot();
  for (const row of Object.values(snapshot.latest!)) {
    row.sp = 44.85;
    row.cp = Number((row.vp! * 0.5 + row.dp! * 0.2 + row.sp * 0.3).toFixed(1));
  }
  const result = validateEtfSnapshot(snapshot, "complete");
  assert.equal(result.status, "unhealthy");
  assert.ok(result.errors.includes("factor_cross_contamination"));
});

test("early snapshot remains valid without unpublished share factors", () => {
  const snapshot = completeSnapshot();
  for (const row of Object.values(snapshot.latest!)) {
    row.sp = null;
    row.shares_yi = null;
    row.cp = Number((row.vp! * 0.7 + row.dp! * 0.3).toFixed(1));
  }
  const result = validateEtfSnapshot(snapshot, "early");
  assert.equal(result.status, "healthy");
  assert.equal(result.metrics.factorCoverage, 0);
});
