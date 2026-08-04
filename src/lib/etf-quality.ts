import registryJson from "../data/etf-registry.json";

export type EtfRegistryItem = {
  secid: string;
  code: string;
  name: string;
  index: string;
  exchange: "SSE" | "SZSE";
  priority: number;
};

export type EtfSnapshotRow = {
  d?: string;
  vp?: number;
  dp?: number;
  sp?: number | null;
  cp?: number;
  shares_yi?: number | null;
  source_code?: string;
  source_date?: string;
};

export type EtfSnapshotLike = {
  schema_version?: number;
  target_date?: string;
  latest?: Record<string, EtfSnapshotRow>;
};

export type EtfQualityResult = {
  status: "healthy" | "unhealthy";
  phase: "early" | "complete";
  errors: string[];
  metrics: {
    expected: number;
    items: number;
    shareCoverage: number;
    factorCoverage: number;
    uniqueShareFactors: number;
  };
};

export const ETF_REGISTRY = registryJson as {
  schema_version: number;
  expected_count: number;
  etfs: EtfRegistryItem[];
};

export const ETF_CODES = ETF_REGISTRY.etfs.map((item) => item.code);

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function validateEtfSnapshot(snapshot: EtfSnapshotLike, requestedPhase: "auto" | "early" | "complete" = "auto"): EtfQualityResult {
  const errors: string[] = [];
  const latest = snapshot.latest && typeof snapshot.latest === "object" ? snapshot.latest : {};
  const actualCodes = Object.keys(latest).sort();
  const expectedCodes = [...ETF_CODES].sort();
  if (JSON.stringify(actualCodes) !== JSON.stringify(expectedCodes)) errors.push("snapshot_codes");
  if (!snapshot.target_date || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.target_date)) errors.push("target_date");

  let shareCoverage = 0;
  let factorCoverage = 0;
  const factors: number[] = [];
  for (const code of ETF_CODES) {
    const row = latest[code];
    if (!row) continue;
    if (row.d !== snapshot.target_date) errors.push(`row_date:${code}`);
    if ((snapshot.schema_version ?? 1) >= 2 && (row.source_code !== code || row.source_date !== snapshot.target_date)) {
      errors.push(`source_identity:${code}`);
    }
    if (finite(row.shares_yi) && row.shares_yi > 0) shareCoverage += 1;
    if (finite(row.sp)) {
      factorCoverage += 1;
      factors.push(row.sp);
    }
    if (!finite(row.vp) || !finite(row.dp) || !finite(row.cp)) {
      errors.push(`factor_shape:${code}`);
      continue;
    }
    const expectedCp = finite(row.sp)
      ? row.vp * 0.5 + row.dp * 0.2 + row.sp * 0.3
      : row.vp * 0.7 + row.dp * 0.3;
    if (Math.abs(expectedCp - row.cp) > 0.15) errors.push(`factor_formula:${code}`);
  }
  const phase = requestedPhase === "auto"
    ? shareCoverage === ETF_REGISTRY.expected_count && factorCoverage === ETF_REGISTRY.expected_count ? "complete" : "early"
    : requestedPhase;
  const uniqueShareFactors = new Set(factors.map((value) => value.toFixed(6))).size;
  if (phase === "complete") {
    if (shareCoverage !== ETF_REGISTRY.expected_count) errors.push("share_coverage");
    if (factorCoverage !== ETF_REGISTRY.expected_count) errors.push("factor_coverage");
    if (factorCoverage > 1 && uniqueShareFactors <= 1) errors.push("factor_cross_contamination");
  }
  return {
    status: errors.length ? "unhealthy" : "healthy",
    phase,
    errors,
    metrics: {
      expected: ETF_REGISTRY.expected_count,
      items: Object.keys(latest).length,
      shareCoverage,
      factorCoverage,
      uniqueShareFactors,
    },
  };
}
