import { useEffect, useRef, useState } from "react";

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
type Resp = {
  ok: boolean;
  ts: number;
  turnover?: Turnover;
  breadth?: Breadth;
  stale?: boolean;
  error?: string;
};

const POLL_MS = 120_000;

function isATradingHours(d: Date = new Date()): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const t = d.getHours() * 60 + d.getMinutes();
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
}

function fmtYi(n: number): string {
  // 以"亿"为单位显示，1 亿 = 1e8。统一 2 位小数，与个股页 / StockSpotlight 一致。
  if (n <= 0) return "—";
  const yi = n / 1e8;
  if (yi >= 10000) return `${(yi / 10000).toFixed(2)} 万亿`;
  return `${yi.toFixed(2)} 亿`;
}

export default function MarketSentiment() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetch("/api/market/sentiment", { cache: "no-store" });
      const d: Resp = await r.json();
      if (d.ok) { setData(d); setError(null); }
      else if (!data) setError(d.error || "加载失败");
    } catch (e: any) {
      if (!data) setError(e?.message || "网络异常");
    } finally {
      inFlight.current = false;
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (!isATradingHours()) return;
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
        加载失败：{error}。<button onClick={load} className="underline ml-1">重试</button>
      </div>
    );
  }

  if (!data || !data.turnover || !data.breadth) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[1,2,3].map(i => <div key={i} className="rounded-2xl bg-[var(--bg-soft)] h-[180px] animate-pulse" />)}
      </div>
    );
  }

  const { turnover, breadth } = data;
  const upRate = breadth.total > 0 ? (breadth.ups / breadth.total) * 100 : 0;
  const downRate = breadth.total > 0 ? (breadth.downs / breadth.total) * 100 : 0;
  const flatRate = breadth.total > 0 ? (breadth.flats / breadth.total) * 100 : 0;

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* 成交额 */}
        <div className="rounded-2xl bg-[var(--bg-soft)] p-5">
          <div className="text-xs text-[var(--text-tertiary)] mb-3">沪深两市成交额</div>
          <div className="text-2xl font-semibold tabular-nums mb-3">{fmtYi(turnover.total)}</div>
          <div className="text-xs text-[var(--text-secondary)] space-y-1 tabular-nums">
            <div className="flex justify-between"><span>沪市</span><span>{fmtYi(turnover.sh)}</span></div>
            <div className="flex justify-between"><span>深市</span><span>{fmtYi(turnover.sz)}</span></div>
          </div>
        </div>

        {/* 涨跌家数 */}
        <div className="rounded-2xl bg-[var(--bg-soft)] p-5">
          <div className="text-xs text-[var(--text-tertiary)] mb-3">市场宽度 <span className="opacity-60">({breadth.total} 只)</span></div>
          <div className="flex items-baseline gap-3 mb-3 tabular-nums">
            <span className="text-2xl font-semibold" style={{ color: "#dc2626" }}>{breadth.ups}</span>
            <span className="text-[var(--text-tertiary)]">/</span>
            <span className="text-2xl font-semibold" style={{ color: "#16a34a" }}>{breadth.downs}</span>
            <span className="text-xs text-[var(--text-tertiary)] ml-auto">平 {breadth.flats}</span>
          </div>
          {/* 比例条 */}
          <div className="flex h-2 rounded-full overflow-hidden bg-[var(--border)] mb-2">
            <div style={{ width: `${upRate}%`, background: "#dc2626" }} />
            <div style={{ width: `${flatRate}%`, background: "#9ca3af" }} />
            <div style={{ width: `${downRate}%`, background: "#16a34a" }} />
          </div>
          <div className="text-[11px] text-[var(--text-tertiary)] tabular-nums">
            涨 {upRate.toFixed(1)}% · 平 {flatRate.toFixed(1)}% · 跌 {downRate.toFixed(1)}%
          </div>
        </div>

        {/* 涨停 / 跌停 */}
        <div className="rounded-2xl bg-[var(--bg-soft)] p-5">
          <div className="text-xs text-[var(--text-tertiary)] mb-3">涨停 / 跌停</div>
          <div className="flex items-baseline gap-3 mb-3 tabular-nums">
            <span className="text-2xl font-semibold" style={{ color: "#dc2626" }}>{breadth.limit_up}</span>
            <span className="text-[var(--text-tertiary)]">/</span>
            <span className="text-2xl font-semibold" style={{ color: "#16a34a" }}>{breadth.limit_down}</span>
          </div>
          <div className="text-xs text-[var(--text-secondary)] space-y-1 tabular-nums">
            {breadth.limit_up_breakdown && (
              <div className="flex justify-between">
                <span>涨停 10cm/20cm</span>
                <span style={{ color: "#dc2626" }}>{breadth.limit_up_breakdown["10cm"]} / {breadth.limit_up_breakdown["20cm"]}</span>
              </div>
            )}
            {breadth.limit_down_breakdown && (
              <div className="flex justify-between">
                <span>跌停 10cm/20cm</span>
                <span style={{ color: "#16a34a" }}>{breadth.limit_down_breakdown["10cm"]} / {breadth.limit_down_breakdown["20cm"]}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-tertiary)] font-mono">
        数据 东方财富 push2delay · 全市场 A 股 + 创业板 + 科创板 · 后端缓存 90s
        {data.ts ? `· 更新于 ${fmtTime(data.ts)}` : ""}
        {data.stale && <span className="ml-2" style={{ color: "#dc2626" }}>· 数据陈旧（上游异常）</span>}
      </p>
    </div>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
