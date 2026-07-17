import { useEffect, useRef, useState } from "react";

/**
 * 宽基 ETF 盘中实时成交监测（/invest/etf/ 页顶部）。
 *
 * 展示 12 只宽基 ETF：现价 / 涨跌 / 今日累计成交额 / vs 昨日全天进度条。
 * ratio ≥ 100% 高亮"已超昨日全天"——财联社盯盘口径。
 *
 * 行为与 MarketIndicesGrid 一致：
 *  - 进页面立即拉一次；交易时段每 60s 轮询；隐藏页停轮询
 *  - 后端 /api/market/etf（东财 push2delay 代理，延迟约 1 分钟）
 *
 * 注意：这里只有价格/成交维度是实时的；三因子模型里的"份额"因子
 * 交易所盘后才披露，仍在下方每日 19:30 更新的板块里。
 */

type EtfItem = {
  code: string;
  name: string;
  price: number | null;
  change_pct: number | null;
  turnover_yi: number | null;
  prev_turnover_yi: number | null;
  ratio_pct: number | null;
};

type Resp = { ok: boolean; ts: number; trading: boolean; items: EtfItem[]; error?: string; stale?: boolean };

const POLL_MS = 60_000;

function isATradingHours(d: Date = new Date()): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const t = d.getHours() * 60 + d.getMinutes();
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function EtfLiveTurnover() {
  const [data, setData] = useState<EtfItem[] | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetch("/api/market/etf", { cache: "no-store" });
      const d: Resp = await r.json();
      if (d.ok) {
        setData(d.items);
        setUpdated(d.ts);
        setError(null);
      } else if (!data) {
        setError(d.error || "加载失败");
      }
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
        实时成交加载失败：{error}。<button onClick={load} className="underline ml-1">重试</button>
      </div>
    );
  }

  if (!data) {
    return <div className="rounded-2xl bg-[var(--bg-soft)] h-[360px] animate-pulse" />;
  }

  const over100 = data.filter((d) => (d.ratio_pct ?? 0) >= 100).length;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm text-[var(--text-secondary)]">
          {over100 > 0 && (
            <span className="font-semibold text-red-600 dark:text-red-400">
              {over100} 只成交额已超昨日全天
            </span>
          )}
        </p>
        <p className="text-[11px] text-[var(--text-tertiary)] font-mono">
          东方财富 · 延迟约 1 分钟 · {updated ? fmtTime(updated) : "—"}
          {!isATradingHours() && "（已收盘）"}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] font-mono border-b border-[var(--border)]">
              <th className="text-left px-3 py-2 font-medium">ETF</th>
              <th className="text-right px-3 py-2 font-medium">现价</th>
              <th className="text-right px-3 py-2 font-medium">涨跌</th>
              <th className="text-right px-3 py-2 font-medium">今日成交</th>
              <th className="text-left px-3 py-2 font-medium w-[220px]">vs 昨日全天</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => {
              const pct = d.change_pct;
              const chgColor = pct == null ? "" : pct > 0 ? "text-red-600 dark:text-red-400" : pct < 0 ? "text-green-600 dark:text-green-400" : "";
              const ratio = d.ratio_pct;
              const overFull = (ratio ?? 0) >= 100;
              const barW = ratio == null ? 0 : Math.min(ratio, 100);
              return (
                <tr key={d.code} className="border-b border-[var(--border-soft,var(--border))] last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-medium">{d.name}</span>
                    <span className="ml-2 text-[11px] text-[var(--text-tertiary)] font-mono">{d.code}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.price?.toFixed(3) ?? "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${chgColor}`}>
                    {pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {d.turnover_yi != null ? `${d.turnover_yi.toFixed(1)} 亿` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-soft)] overflow-hidden">
                        <div
                          className={`h-full rounded-full ${overFull ? "bg-red-500" : "bg-zinc-400 dark:bg-zinc-500"}`}
                          style={{ width: `${barW}%` }}
                        />
                      </div>
                      <span className={`text-[11px] tabular-nums font-mono w-14 text-right ${overFull ? "text-red-600 dark:text-red-400 font-semibold" : "text-[var(--text-tertiary)]"}`}>
                        {ratio != null ? `${ratio.toFixed(0)}%` : "—"}
                      </span>
                      {overFull && <span className="text-[11px]">✓</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
