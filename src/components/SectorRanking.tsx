import { useEffect, useRef, useState } from "react";

/**
 * 行业板块涨跌排行（细分行业 m:90 t:2）。
 * 每 60s 轮询，仅交易时段。
 * 上下两列：涨幅 Top 10 / 跌幅 Top 10
 */

type Sector = {
  code: string;
  name: string;
  price: number | null;
  change_pct: number | null;
};

type Resp = {
  ok: boolean;
  ts: number;
  total?: number;
  top_up?: Sector[];
  top_down?: Sector[];
  error?: string;
};

const POLL_MS = 60_000;

function isATradingHours(d: Date = new Date()): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const t = d.getHours() * 60 + d.getMinutes();
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
}

interface Props {
  /** SSR 兜底：服务端从 wind-market-latest.json sectors 映射好 */
  initialData?: Resp;
}

export default function SectorRanking({ initialData }: Props = {}) {
  const [data, setData] = useState<Resp | null>(initialData ?? null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetch("/api/market/sectors", { cache: "no-store" });
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

  if (!data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-2xl bg-[var(--bg-soft)] h-[260px] animate-pulse" />
        <div className="rounded-2xl bg-[var(--bg-soft)] h-[260px] animate-pulse" />
      </div>
    );
  }

  const ups = data.top_up || [];
  const downs = data.top_down || [];

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SectorList title="涨幅榜" items={ups} color="#dc2626" arrow="▲" />
        <SectorList title="跌幅榜" items={downs} color="#16a34a" arrow="▼" />
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-tertiary)] font-mono">
        细分行业板块 · 共 {data.total ?? "?"} 个 · {data.ts ? `更新于 ${fmtTime(data.ts)}` : ""}
      </p>
    </div>
  );
}

function SectorList({ title, items, color, arrow }: { title: string; items: Sector[]; color: string; arrow: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-3 bg-[var(--bg-soft)] flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[10px] font-mono uppercase tracking-wide" style={{ color }}>{arrow} Top 10</span>
      </div>
      <ul>
        {items.length === 0 && <li className="px-4 py-6 text-sm text-[var(--text-tertiary)] text-center">暂无数据</li>}
        {items.map((s, i) => (
          <li key={s.code} className="px-4 py-2.5 border-t border-[var(--border)] flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs font-mono text-[var(--text-tertiary)] w-5 text-right">{i + 1}</span>
              <span className="text-sm truncate">{s.name}</span>
            </div>
            <span className="text-sm font-semibold tabular-nums whitespace-nowrap" style={{ color }}>
              {s.change_pct != null ? `${s.change_pct > 0 ? "+" : ""}${s.change_pct.toFixed(2)}%` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
