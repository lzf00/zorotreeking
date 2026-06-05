import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 通用个股聚焦组件。
 * 父组件传 stocks（含 secid + 业务说明），自动调 /api/market/stocks 拉实时报价。
 *
 * - 60s 轮询，仅 A 股交易时段
 * - A 股配色：红涨绿跌
 */

type StockSeed = {
  secid: string;          // "1.688981" 这种带前缀的格式
  display_name?: string;  // 本地优先显示名（兜底用，否则用上游返回的 f14）
  note?: string;          // 一句话业务说明
};

type Quote = {
  secid: string;
  code: string;
  name: string | null;
  price: number | null;
  change: number | null;
  change_pct: number | null;
};

type Resp = { ok: boolean; ts: number; stocks: Quote[]; error?: string };

interface Props {
  stocks: StockSeed[];
  /** 是否显示业务说明列 */
  showNote?: boolean;
  /** SSR 兜底：服务端从 wind-market-latest.json 映射好的 quotes（按 secid 索引） */
  initialQuotes?: Record<string, Quote>;
  initialUpdated?: number;
}

const POLL_MS = 60_000;

function isATradingHours(d: Date = new Date()): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const t = d.getHours() * 60 + d.getMinutes();
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
}

export default function StockSpotlight({ stocks, showNote = true, initialQuotes, initialUpdated }: Props) {
  const [quotes, setQuotes] = useState<Record<string, Quote> | null>(
    initialQuotes && Object.keys(initialQuotes).length > 0 ? initialQuotes : null,
  );
  const [updated, setUpdated] = useState<number | null>(initialUpdated ?? null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const codes = useMemo(() => stocks.map(s => s.secid).join(","), [stocks]);

  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetch(`/api/market/stocks?codes=${codes}`, { cache: "no-store" });
      const d: Resp = await r.json();
      if (d.ok) {
        const map: Record<string, Quote> = {};
        for (const q of d.stocks) map[q.secid] = q;
        setQuotes(map);
        setUpdated(d.ts);
        setError(null);
      } else if (!quotes) setError(d.error || "加载失败");
    } catch (e: any) {
      if (!quotes) setError(e?.message || "网络异常");
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

  if (!quotes && error) {
    return (
      <div className="rounded-2xl bg-[var(--bg-soft)] p-5 text-sm text-[var(--text-tertiary)]">
        加载失败：{error}。<button onClick={load} className="underline ml-1">重试</button>
      </div>
    );
  }

  if (!quotes) {
    return <div className="rounded-2xl bg-[var(--bg-soft)] p-5 h-[280px] animate-pulse" />;
  }

  // 板块平均涨跌（每只权重相等）
  const valid = stocks
    .map(s => quotes[s.secid]?.change_pct)
    .filter((p): p is number => p != null);
  const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  const avgColor = avg == null ? "var(--text-tertiary)" : avg > 0 ? "#dc2626" : avg < 0 ? "#16a34a" : "var(--text-tertiary)";

  return (
    <div className="space-y-3">
      <div className="text-xs text-[var(--text-tertiary)] flex items-baseline gap-4">
        <span>板块平均：
          <span className="font-semibold tabular-nums ml-1" style={{ color: avgColor }}>
            {avg == null ? "—" : `${avg > 0 ? "+" : ""}${avg.toFixed(2)}%`}
          </span>
        </span>
        <span className="font-mono text-[10.5px]">{updated ? `更新于 ${fmtTime(updated)}` : ""}</span>
      </div>
      <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-soft)] text-xs text-[var(--text-secondary)]">
              <tr>
                <th className="text-left p-3 font-semibold">代码</th>
                <th className="text-left p-3 font-semibold">名称</th>
                <th className="text-right p-3 font-semibold">现价</th>
                <th className="text-right p-3 font-semibold">涨跌</th>
                <th className="text-right p-3 font-semibold">涨跌幅</th>
                {showNote && <th className="text-left p-3 font-semibold hidden sm:table-cell">主营</th>}
              </tr>
            </thead>
            <tbody>
              {stocks.map(s => {
                const q = quotes[s.secid];
                const pct = q?.change_pct;
                const color = pct == null ? "var(--text-tertiary)" : pct > 0 ? "#dc2626" : pct < 0 ? "#16a34a" : "var(--text-tertiary)";
                const sign = (n: number | null | undefined) => (n != null && n > 0 ? "+" : "");
                const name = q?.name || s.display_name || s.secid;
                return (
                  <tr key={s.secid} className="border-t border-[var(--border)]">
                    <td className="p-3 font-mono text-xs">{q?.code || s.secid.split(".")[1]}</td>
                    <td className="p-3 whitespace-nowrap">{name}</td>
                    <td className="p-3 text-right tabular-nums">{q?.price != null ? q.price.toFixed(2) : "—"}</td>
                    <td className="p-3 text-right tabular-nums" style={{ color }}>
                      {q?.change != null ? `${sign(q.change)}${q.change.toFixed(2)}` : "—"}
                    </td>
                    <td className="p-3 text-right tabular-nums" style={{ color }}>
                      {pct != null ? `${sign(pct)}${pct.toFixed(2)}%` : "—"}
                    </td>
                    {showNote && (
                      <td className="p-3 text-xs text-[var(--text-secondary)] hidden sm:table-cell whitespace-nowrap">{s.note || "—"}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
