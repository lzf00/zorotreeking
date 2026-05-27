import { useEffect, useRef, useState } from "react";

/**
 * 实时大盘指数栏：7 大指数（A 股 5 + 港股 1 + 美股 1）。
 *
 * 行为：
 *  - 进入页面立即拉一次
 *  - 之后每 60 秒轮询一次（仅在 A 股交易时段 9:30-11:30 + 13:00-15:00 工作日）
 *  - 标签页隐藏时停轮询，切回 visible 立即补一次
 *  - 出错时静默保留上一次成功数据；只在初次失败时显示错误
 *
 * 后端：/api/market/indices （东方财富 push2 代理 + 5s 缓存）
 */

type Index = {
  code: string;
  name: string;
  market: "A" | "HK" | "US";
  price: number | null;
  change: number | null;
  change_pct: number | null;
};

type Resp = { ok: boolean; ts: number; indices: Index[]; error?: string };

const POLL_MS = 60_000;

/** A 股交易时段判断（北京时间，工作日 9:30-11:30 + 13:00-15:00） */
function isATradingHours(d: Date = new Date()): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const t = d.getHours() * 60 + d.getMinutes();
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
}

export default function MarketIndicesGrid() {
  const [data, setData] = useState<Index[] | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const r = await fetch("/api/market/indices", { cache: "no-store" });
      const d: Resp = await r.json();
      if (d.ok) {
        setData(d.indices);
        setUpdated(d.ts);
        setError(null);
      } else {
        if (!data) setError(d.error || "加载失败");
      }
    } catch (e: any) {
      if (!data) setError(e?.message || "网络异常");
    } finally {
      inFlight.current = false;
      setLoading(false);
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
        大盘行情加载失败：{error}。<button onClick={load} className="underline ml-1">重试</button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="rounded-2xl bg-[var(--bg-soft)] p-4 h-[92px] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <section>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {data.map((d) => <IndexCard key={d.code} d={d} />)}
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-tertiary)] font-mono tracking-wide">
        数据源 东方财富 · 延迟约 15 秒 · 更新于 {updated ? fmtTime(updated) : "—"}
        {!isATradingHours() && <span className="ml-2">（非交易时段，已停止自动刷新）</span>}
        {loading && <span className="ml-2">…</span>}
      </p>
    </section>
  );
}

function IndexCard({ d }: { d: Index }) {
  const pct = d.change_pct;
  const up = (pct ?? 0) > 0;
  const down = (pct ?? 0) < 0;
  // A 股配色：红涨绿跌
  const color = up ? "#dc2626" : down ? "#16a34a" : "var(--text-tertiary)";
  const arrow = up ? "▲" : down ? "▼" : "—";
  const fmt = (n: number | null, digits = 2) =>
    n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = (n: number | null) => (n != null && n > 0 ? "+" : "");

  return (
    <div className="rounded-2xl bg-[var(--bg-soft)] hover:bg-[var(--bg-soft-2)] transition-colors p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--text-tertiary)]">{d.name}</span>
        <span className="text-[10px] font-mono text-[var(--text-tertiary)] opacity-70">{d.market}</span>
      </div>
      <div className="text-xl font-semibold tabular-nums leading-none mb-2">
        {fmt(d.price)}
      </div>
      <div className="text-xs tabular-nums" style={{ color }}>
        {arrow} {sign(d.change)}{fmt(d.change)} ({sign(pct)}{fmt(pct)}%)
      </div>
    </div>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
