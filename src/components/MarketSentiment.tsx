import { useEffect, useRef, useState } from "react";
import { formatChinaMarketTime, isChinaATradingHours } from "@/lib/china-market";
import { formatYi, marketLabels, type MarketLang } from "@/lib/market-i18n";

/**
 * 市场情绪：沪深成交额 + 涨跌平家数 + 涨停跌停板。
 * 后端 /api/market/sentiment 缓存 90 秒；前端 2 分钟轮询一次（仅交易时段）。
 * 数据每分钟变化幅度小，不需要 60s 高频。
 */

type Turnover = { sh: number; sz: number; total: number };
type Breadth = {
  total: number;
  ups: number;
  downs: number;
  flats: number;
  limit_up: number;
  limit_up_breakdown?: { "10cm": number; "20cm": number };
  limit_down: number;
  limit_down_breakdown?: { "10cm": number; "20cm": number };
};
/** SSR 兜底快照可能只带涨跌停家数（Wind 快照里就没有全量宽度），所以这里放宽成部分字段 */
type BreadthSeed = { limit_up: number; limit_down: number };
type Resp = {
  ok: boolean;
  ts: number;
  turnover?: Turnover;
  breadth?: Partial<Breadth> & BreadthSeed;
  stale?: boolean;
  error?: string;
};

const POLL_MS = 120_000;

function fmtYi(n: number, lang: MarketLang): string {
  // 以"亿"为单位换算，1 亿 = 1e8。英文按 B/T 显示。
  if (n <= 0) return "—";
  return formatYi(n / 1e8, lang);
}

interface Props {
  /** SSR 兜底：服务端从 wind-market-latest.json sentiment 映射好 */
  initialData?: Resp;
  lang?: MarketLang;
}

export default function MarketSentiment({ initialData, lang = "zh" }: Props = {}) {
  const L = marketLabels(lang);
  const [data, setData] = useState<Resp | null>(initialData ?? null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetch("/api/market/sentiment", { cache: "no-store" });
      const d: Resp = await r.json();
      if (d.ok) { setData(d); setError(null); }
      else if (!data) setError(d.error || L.loadFailed);
    } catch (e: any) {
      if (!data) setError(e?.message || L.networkError);
    } finally {
      inFlight.current = false;
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (!isChinaATradingHours()) return;
      load();
    }, POLL_MS);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data && error) {
    return (
      <div className="rounded-2xl bg-[var(--bg-soft)] p-5 text-sm text-[var(--text-tertiary)]">
        {L.loadFailedPrefix(L.sectionSentiment)}{error}{L.sentenceEnd}
        <button onClick={load} className="underline ml-1">{L.retry}</button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[1,2,3].map(i => <div key={i} className="rounded-2xl bg-[var(--bg-soft)] h-[180px] animate-pulse" />)}
      </div>
    );
  }

  // 构建快照里没有成交额，但有涨跌家数/涨跌停。以前这里要求 turnover 存在才渲染，
  // 于是 SSR 只能吐三块骨架，等实时接口（冷启动 3 秒）回来才整块换掉——首屏视觉进度
  // 一下掉到 2.8 秒。现在有 seed 就先画能画的，成交额缺就显示「—」。
  const { breadth } = data;
  const turnover = data.turnover;
  const missingBreadth = !breadth;
  const breadthTotal = breadth?.total ?? 0;
  const breadthUps = breadth?.ups ?? 0;
  const breadthDowns = breadth?.downs ?? 0;
  const breadthFlats = breadth?.flats ?? 0;
  const upRate = breadthTotal > 0 ? (breadthUps / breadthTotal) * 100 : 0;
  const downRate = breadthTotal > 0 ? (breadthDowns / breadthTotal) * 100 : 0;
  const flatRate = breadthTotal > 0 ? (breadthFlats / breadthTotal) * 100 : 0;

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* 成交额 */}
        <div className="rounded-2xl bg-[var(--bg-soft)] p-5">
          <div className="text-xs text-[var(--text-tertiary)] mb-3">
            {L.turnoverTitle}
            {/* 快照里没有成交额：先占位，别让整块等接口回来才出现（视觉进度会掉到 2.8 秒） */}
            {!turnover ? <span className="ml-2 text-[10px]">{lang === "zh" ? "更新中" : "updating"}</span> : null}
          </div>
          <div className="text-2xl font-semibold tabular-nums mb-3">{fmtYi(turnover?.total ?? 0, lang)}</div>
          <div className="text-xs text-[var(--text-secondary)] space-y-1 tabular-nums">
            <div className="flex justify-between"><span>{L.shanghai}</span><span>{fmtYi(turnover?.sh ?? 0, lang)}</span></div>
            <div className="flex justify-between"><span>{L.shenzhen}</span><span>{fmtYi(turnover?.sz ?? 0, lang)}</span></div>
          </div>
        </div>

        {/* 涨跌家数 */}
        <div className="rounded-2xl bg-[var(--bg-soft)] p-5">
          <div className="text-xs text-[var(--text-tertiary)] mb-3">
            {L.breadthTitle} {breadth ? <span className="text-[var(--text-secondary)]">{L.breadthCount(breadthTotal)}</span> : null}
          </div>
          {missingBreadth ? (
            <div className="text-sm text-[var(--text-tertiary)]">{L.breadthMissing}</div>
          ) : (
            <>
              <div className="flex items-baseline gap-3 mb-3 tabular-nums">
                <span className="text-2xl font-semibold" style={{ color: "var(--market-up)" }}>{breadthUps}</span>
                <span className="text-[var(--text-tertiary)]">/</span>
                <span className="text-2xl font-semibold" style={{ color: "var(--market-down)" }}>{breadthDowns}</span>
                <span className="text-xs text-[var(--text-tertiary)] ml-auto">{L.flatShort(breadthFlats)}</span>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden bg-[var(--border)] mb-2">
                <div style={{ width: `${upRate}%`, background: "#dc2626" }} />
                <div style={{ width: `${flatRate}%`, background: "#9ca3af" }} />
                <div style={{ width: `${downRate}%`, background: "#16a34a" }} />
              </div>
              <div className="text-[11px] text-[var(--text-tertiary)] tabular-nums">
                {L.breadthRates(upRate.toFixed(1), flatRate.toFixed(1), downRate.toFixed(1))}
              </div>
            </>
          )}
        </div>

        {/* 涨停 / 跌停 */}
        <div className="rounded-2xl bg-[var(--bg-soft)] p-5">
          <div className="text-xs text-[var(--text-tertiary)] mb-3">{L.limitTitle}</div>
          {missingBreadth ? (
            <div className="text-sm text-[var(--text-tertiary)]">{L.limitMissing}</div>
          ) : (
            <>
              <div className="flex items-baseline gap-3 mb-3 tabular-nums">
                <span className="text-2xl font-semibold" style={{ color: "var(--market-up)" }}>{breadth.limit_up}</span>
                <span className="text-[var(--text-tertiary)]">/</span>
                <span className="text-2xl font-semibold" style={{ color: "var(--market-down)" }}>{breadth.limit_down}</span>
              </div>
              <div className="text-xs text-[var(--text-secondary)] space-y-1 tabular-nums">
                {breadth.limit_up_breakdown && (
                  <div className="flex justify-between">
                    <span>{L.limitUp}</span>
                    <span style={{ color: "var(--market-up)" }}>{breadth.limit_up_breakdown["10cm"]} / {breadth.limit_up_breakdown["20cm"]}</span>
                  </div>
                )}
                {breadth.limit_down_breakdown && (
                  <div className="flex justify-between">
                    <span>{L.limitDown}</span>
                    <span style={{ color: "var(--market-down)" }}>{breadth.limit_down_breakdown["10cm"]} / {breadth.limit_down_breakdown["20cm"]}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-tertiary)] font-mono">
        {L.sentimentSource}
        {data.ts ? ` · ${L.apiResponse} ${formatChinaMarketTime(data.ts)}` : ""}
        {data.stale && <span className="ml-2" style={{ color: "var(--market-up)" }}>{L.staleNote}</span>}
      </p>
    </div>
  );
}
