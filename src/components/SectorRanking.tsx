import { useEffect, useRef, useState } from "react";
import { formatChinaMarketTime, isChinaATradingHours } from "@/lib/china-market";
import { classifyLaggingSectors } from "@/lib/market-quality";
import { marketLabels, sectorName, type MarketLang, type MarketLabels } from "@/lib/market-i18n";
import { humanizeMarketError } from "@/lib/api-error";

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
  stale?: boolean;
  source?: string;
  error?: string;
};

const POLL_MS = 60_000;

function sectorSourceLabel(data: Resp, L: MarketLabels): string {
  if (data.source === "sina_hy") return L.sourceSinaSector;
  if (data.source === "eastmoney") return L.sourceEastmoney;
  if (data.stale) return L.sourceSnapshot;
  return L.sourceEastmoney;
}

interface Props {
  /** SSR 兜底：服务端从 wind-market-latest.json sectors 映射好 */
  initialData?: Resp;
  lang?: MarketLang;
}

export default function SectorRanking({ initialData, lang = "zh" }: Props = {}) {
  const L = marketLabels(lang);
  const [data, setData] = useState<Resp | null>(initialData ?? null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetch("/api/market/sectors", { cache: "no-store" });
      if (!r.ok) {
        throw new Error(`接口响应异常：${r.status} ${r.statusText}`);
      }
      const raw = await r.json();
      const d: Resp = raw && typeof raw === "object" ? raw : ({} as Resp);
      if (d.ok) { setData(d); setError(null); }
      else if (!data) setError(humanizeMarketError(d.error, lang));
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
        {L.loadFailedPrefix(L.sectionSectors)}{error}{L.sentenceEnd}
        <button onClick={load} className="underline ml-1">{L.retry}</button>
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
  const lagging = classifyLaggingSectors(data.top_down || []);

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SectorList title={L.sectorUpTitle} items={ups} color="var(--market-up)" arrow="▲" noData={L.sectorNoData} lang={lang} />
        <SectorList
          title={
            lagging.items.length === 0
              ? L.sectorDownPending
              : lagging.kind === "decliners"
                ? L.sectorDownTitle
                : L.sectorRelativeBottomTitle
          }
          noData={L.sectorNoData}
          items={lagging.items}
          color={lagging.direction === "down" ? "var(--market-down)" : "var(--market-up)"}
          arrow={lagging.direction === "down" ? "▼" : "▲"}
          lang={lang}
        />
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-tertiary)] font-mono">
        {L.sourcePrefix}
        {sectorSourceLabel(data, L)} · {L.sectorCount(String(data.total ?? "?"))} ·{" "}
        {data.ts ? `${data.stale ? L.snapshotTime : L.apiResponse} ${formatChinaMarketTime(data.ts)}` : L.none}
        {data.stale && <span className="ml-2 text-amber-700 dark:text-amber-400">{L.liveNotUpdated}</span>}
      </p>
    </div>
  );
}

function SectorList({ title, items, color, arrow, noData, lang }: { title: string; items: Sector[]; color: string; arrow: string; noData: string; lang: MarketLang }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-3 bg-[var(--bg-soft)] flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[10px] font-mono uppercase tracking-wide" style={{ color }}>{arrow} Top 10</span>
      </div>
      <ul>
        {items.length === 0 && <li className="px-4 py-6 text-sm text-[var(--text-tertiary)] text-center">{noData}</li>}
        {items.map((s, i) => (
          <li key={s.code} className="px-4 py-2.5 border-t border-[var(--border)] flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs font-mono text-[var(--text-tertiary)] w-5 text-right">{i + 1}</span>
              <span className="text-sm truncate">{sectorName(s.name, lang)}</span>
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
