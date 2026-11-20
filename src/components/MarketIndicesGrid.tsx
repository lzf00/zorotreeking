import { useEffect, useRef, useState } from "react";
import { formatChinaMarketTime, isChinaATradingHours } from "@/lib/china-market";
import { indexName, marketLabels, type MarketLang } from "@/lib/market-i18n";

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
interface Props {
  /** 服务端兜底数据。SSR 时直接渲染这份；hydrate 后 useEffect 拉 /api/market 覆盖 */
  initialIndices?: Index[];
  initialUpdated?: number;
  initialSource?: "wind_snapshot";
  /** 文案语言，英文页传 "en" */
  lang?: MarketLang;
}

export default function MarketIndicesGrid({ initialIndices, initialUpdated, initialSource, lang = "zh" }: Props = {}) {
  const L = marketLabels(lang);
  const [data, setData] = useState<Index[] | null>(initialIndices && initialIndices.length > 0 ? initialIndices : null);
  const [updated, setUpdated] = useState<number | null>(initialUpdated ?? null);
  const [source, setSource] = useState<"live" | "wind_snapshot">(
    initialSource === "wind_snapshot" ? "wind_snapshot" : "live",
  );
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
        setSource("live");
        setError(null);
      } else {
        if (!data) setError(d.error || L.loadFailed);
      }
    } catch (e: any) {
      if (!data) setError(e?.message || L.networkError);
    } finally {
      inFlight.current = false;
      setLoading(false);
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
        {L.indicesLoadFailed}{error}{L.sentenceEnd}
        <button onClick={load} className="underline ml-1">{L.retry}</button>
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
        {data.map((d) => <IndexCard key={d.code} d={d} lang={lang} />)}
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-tertiary)] font-mono tracking-wide">
        {L.sourcePrefix}
        {source === "live" ? L.sourceEastmoney : L.sourceWindSnapshot} · {source === "live" ? L.apiResponse : L.snapshotTime}{" "}
        {updated ? formatChinaMarketTime(updated) : L.none}
        {source === "wind_snapshot" && <span className="ml-2 text-amber-700 dark:text-amber-400">{L.liveNotUpdated}</span>}
        {!isChinaATradingHours() && <span className="ml-2">{L.marketClosedNote}</span>}
        {loading && <span className="ml-2">…</span>}
      </p>
    </section>
  );
}

function IndexCard({ d, lang }: { d: Index; lang: MarketLang }) {
  const pct = d.change_pct;
  const up = (pct ?? 0) > 0;
  const down = (pct ?? 0) < 0;
  // A 股配色：红涨绿跌
  const color = up ? "var(--market-up)" : down ? "var(--market-down)" : "var(--text-tertiary)";
  const arrow = up ? "▲" : down ? "▼" : "—";
  const fmt = (n: number | null, digits = 2) =>
    n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = (n: number | null) => (n != null && n > 0 ? "+" : "");

  return (
    // min-h 固定住卡片高度：SSR 兜底只有 3 个指数、接口会返回 7 个，卡片宽度不同
    // 会让指数名换行行数不同 —— 高度一变，下面所有板块跟着跳。实测 /en/invest/ 的
    // CLS 0.073 就是这一处（第 67 轮归因）。定高后宽度变化不再影响行高。
    <div className="rounded-2xl bg-[var(--bg-soft)] hover:bg-[var(--bg-soft-2)] transition-colors p-4 min-h-[92px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--text-tertiary)]">{indexName(d.code, d.name, lang)}</span>
        <span className="text-[10px] font-mono text-[var(--text-secondary)]">{d.market}</span>
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
