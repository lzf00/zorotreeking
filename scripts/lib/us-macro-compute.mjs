/**
 * 从 BLS（美国劳工统计局）公开序列算出 `/invest/us-market/` 用的宏观块（第 136 轮）。
 *
 * 背景：页面首屏写着「当前状态：就业降温 / 通胀降温 / 降息压力上升」，但那三个词是
 * CPI 2026-06、非农 2026-07 推出来的——数据抓取停了 102 天（第 135 轮才把这件事写在首屏）。
 * 采集脚本不在这个仓库里，所以这轮把**只读 BLS 公开接口**的那一半补进来：
 * CPI 同比、核心 CPI 同比、非农月增量、失业率，四个序列全部来自官方 API，不需要 key。
 *
 * 这里只做纯计算（输入 BLS 原始 payload，输出 macro 对象），网络在 fetch 脚本里，
 * 这样才能用固定样本单测。
 */

/** 四个序列：CPI（NSA）与核心 CPI 用 1982-84=100 的指数算同比；非农用季调总人数算月增量。 */
export const BLS_SERIES = {
  cpi: "CUUR0000SA0",
  core_cpi: "CUUR0000SA0L1E",
  unemployment: "LNS14000000",
  payroll: "CES0000000001",
};

const MONTH_PATTERN = /^M(\d{2})$/;

/** BLS 的 `{year, period, value, footnotes}` → `[{ ym: "2026-10", value, preliminary }]`，按时间升序。 */
export function normalizeSeries(rows) {
  const points = [];
  for (const row of rows ?? []) {
    const month = MONTH_PATTERN.exec(String(row?.period ?? ""));
    if (!month) continue; // M13 是年均值，不能进月度序列
    const value = Number(row?.value);
    if (!Number.isFinite(value)) continue;
    const index = Number(month[1]);
    if (index < 1 || index > 12) continue;
    points.push({
      ym: `${row.year}-${String(index).padStart(2, "0")}`,
      value,
      preliminary: (row.footnotes ?? []).some((note) => note?.code === "P"),
    });
  }
  return points.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
}

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * 同比序列：每条都需要 12 个月前的同月值。返回与输入同长（前 12 个月为 null 被滤掉）。
 */
export function yearOverYear(points) {
  const byYm = new Map(points.map((point) => [point.ym, point]));
  const out = [];
  for (const point of points) {
    const [year, month] = point.ym.split("-").map(Number);
    const base = byYm.get(`${year - 1}-${String(month).padStart(2, "0")}`);
    if (!base || base.value === 0) continue;
    out.push({ date: point.ym, value: round1((point.value / base.value - 1) * 100), preliminary: point.preliminary });
  }
  return out;
}

/** 月增量（非农人数，单位千人）：相邻两个月的水平值相减。 */
export function monthOverMonth(points) {
  const out = [];
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1];
    // 只对相邻月份做差，中间断月就跳过（否则会把两个月的合计算成一个月）
    if (monthGap(previous.ym, current.ym) !== 1) continue;
    out.push({ date: current.ym, value: Math.round(current.value - previous.value), preliminary: current.preliminary });
  }
  return out;
}

function monthGap(from, to) {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** 取序列最后一期；不足两期就返回 null，让调用方保持陈旧数据而不是写半截。 */
export function latestPair(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  return { latest, previous };
}

/**
 * @param {{ cpi?: any[], core_cpi?: any[], unemployment?: any[], payroll?: any[] }} raw BLS 四个序列的 data 数组
 * `maxConsensusAgeDays`（第 160 轮）：一致预期也会过期。
 * 这份"市场一致预期"只有一个 2026-08-07 的种子，没有任何任务在刷新它 ——
 * 于是 106 天前的预期一直参与"偏鹰/偏鸽"判断。过期就该当成没有（预期 → null，
 * 判断退回"按前值比较 + 置信度有限"），而不是拿三个月前的预期当真。
 *
 * @param {{ fetchedAt: number, carryExpected?: object|null, now?: number, maxConsensusAgeDays?: number }} options
 */
export function computeUsMacro(
  raw,
  { fetchedAt, carryExpected = null, now = fetchedAt * 1000, maxConsensusAgeDays = 45 } = {},
) {
  const cpiSeries = normalizeSeries(raw?.cpi);
  const coreSeries = normalizeSeries(raw?.core_cpi);
  const unemploymentSeries = normalizeSeries(raw?.unemployment);
  const payrollSeries = normalizeSeries(raw?.payroll);

  const cpiYoy = yearOverYear(cpiSeries);
  const coreYoy = yearOverYear(coreSeries);
  const payrollMoM = monthOverMonth(payrollSeries);

  const cpiPair = latestPair(cpiYoy);
  const corePair = latestPair(coreYoy);
  const payrollPair = latestPair(payrollMoM);
  const unemploymentPair = latestPair(unemploymentSeries);

  // 任何一个序列拿不到两期，就整体失败：宁可显示"数据陈旧"，也不要显示半真半假的新数据
  const missing = [
    ["cpi", cpiPair],
    ["core_cpi", corePair],
    ["payroll", payrollPair],
    ["unemployment", unemploymentPair],
  ].filter(([, pair]) => !pair).map(([name]) => name);
  if (missing.length > 0) {
    return { ok: false, error: `BLS 序列不足：${missing.join("/")}` };
  }

  // Trading Economics 的市场一致预期这轮没有可靠来源，只在参考期完全一致时才沿用旧值，
  // 否则留空（界面会显示"置信度有限"，比拿旧月份的预期冒充本月强）。
  // 一致预期能不能用：既要"参考期对得上"，也要"没过期"。
  const consensusMs = carryExpected?.consensus?.updated_at ? Date.parse(carryExpected.consensus.updated_at) : Number.NaN;
  const consensusAgeDays = Number.isNaN(consensusMs) ? null : Math.floor((now - consensusMs) / 86_400_000);
  const consensusUsable =
    carryExpected?.consensusMatches === true &&
    consensusAgeDays !== null &&
    consensusAgeDays <= maxConsensusAgeDays;

  const expectedFor = (key, reference) => {
    if (!consensusUsable) return null;
    const carried = carryExpected?.[key];
    if (!carried || carried.reference !== reference) return null;
    return carried.expected ?? null;
  };

  const macro = {
    source: "bls",
    source_url: "https://www.bls.gov/developers/api_signature_v2.htm",
    fetched_at: fetchedAt,
    stale: false,
    cpi: {
      reference: cpiPair.latest.date,
      actual: cpiPair.latest.value,
      expected: expectedFor("cpi", cpiPair.latest.date),
      previous: cpiPair.previous.value,
      preliminary: cpiPair.latest.preliminary,
    },
    core_cpi: {
      reference: corePair.latest.date,
      actual: corePair.latest.value,
      expected: expectedFor("core_cpi", corePair.latest.date),
      previous: corePair.previous.value,
      preliminary: corePair.latest.preliminary,
    },
    payroll: {
      reference: payrollPair.latest.date,
      actual: payrollPair.latest.value,
      expected: expectedFor("payroll", payrollPair.latest.date),
      previous: payrollPair.previous.value,
      preliminary: payrollPair.latest.preliminary,
    },
    unemployment: {
      reference: unemploymentPair.latest.ym,
      actual: unemploymentPair.latest.value,
      expected: expectedFor("unemployment", unemploymentPair.latest.date),
      previous: unemploymentPair.previous.value,
      preliminary: unemploymentPair.latest.preliminary,
    },
    trends: {
      cpi: cpiYoy.slice(-13),
      core_cpi: coreYoy.slice(-13),
      payroll: payrollMoM.slice(-13),
      unemployment: unemploymentSeries.slice(-13).map((point) => ({
        date: point.ym,
        value: point.value,
        ...(point.preliminary ? { preliminary: true } : {}),
      })),
    },
    consensus: consensusUsable ? carryExpected.consensus ?? null : null,
  };
  return { ok: true, macro };
}
