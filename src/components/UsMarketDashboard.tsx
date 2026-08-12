import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deriveUsMacroJudgement,
  isUsRegularMarketHours,
  mergeUsMarketDashboardData,
  type MacroComparison,
  type UsMacroMetric,
  type UsMarketDashboardData,
  type UsQuote,
  type UsTrendPoint,
} from "@/lib/us-market";

const POLL_MS = 60_000;

type Props = {
  initialData?: UsMarketDashboardData | null;
};

const emptyMetric: UsMacroMetric = {
  reference: null,
  actual: null,
  expected: null,
  previous: null,
  preliminary: false,
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatPercent(value: number | null, digits = 1): string {
  return finite(value) ? `${value.toFixed(digits)}%` : "—";
}

function formatPayroll(value: number | null): string {
  if (!finite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value / 10).toFixed(1)}万`;
}

function formatPrice(value: number | null): string {
  return finite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })
    : "—";
}

function formatQuoteTime(value: number | null | undefined): string {
  if (!finite(value)) return "—";
  return new Date(value * 1000).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function metricDirection(metric: MacroComparison): "down" | "up" | "flat" {
  if (!finite(metric.actual) || !finite(metric.previous)) return "flat";
  return metric.actual < metric.previous ? "down" : metric.actual > metric.previous ? "up" : "flat";
}

function MetricRow({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-slate-900/10 py-2.5 first:border-0 dark:border-white/10">
      <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">{label}</span>
      <span className={`font-mono tabular-nums ${emphasize ? "text-base font-semibold" : "text-sm text-[var(--text-secondary)]"}`}>{value}</span>
    </div>
  );
}

function MacroCard({
  eyebrow,
  title,
  metric,
  formatter,
  note,
}: {
  eyebrow: string;
  title: string;
  metric: UsMacroMetric;
  formatter: (value: number | null) => string;
  note: string;
}) {
  const direction = metricDirection(metric);
  const arrow = direction === "down" ? "↓" : direction === "up" ? "↑" : "→";
  return (
    <article className="rounded-[1.35rem] border border-slate-900/10 bg-white/75 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.035]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#64748b]">{eyebrow}</p>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h3>
        </div>
        <span className={`text-3xl font-light ${direction === "down" ? "text-emerald-600" : direction === "up" ? "text-rose-600" : "text-slate-400"}`} aria-label={direction === "down" ? "较前值下降" : direction === "up" ? "较前值上升" : "与前值持平"}>
          {arrow}
        </span>
      </div>
      <div className="mt-5">
        <MetricRow label="实际" value={formatter(metric.actual)} emphasize />
        <MetricRow label="预期" value={formatter(metric.expected)} />
        <MetricRow label="前值" value={formatter(metric.previous)} />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        {metric.reference ?? "参考期未知"}{metric.preliminary ? " · 初值" : ""} · {note}
      </p>
    </article>
  );
}

function TrendChart({
  title,
  unit,
  data,
  tone,
}: {
  title: string;
  unit: string;
  data: UsTrendPoint[];
  tone: "navy" | "red" | "green" | "gold";
}) {
  const width = 360;
  const height = 126;
  const padX = 12;
  const padY = 16;
  const values = data.map((point) => point.value).filter(Number.isFinite);
  const minRaw = values.length ? Math.min(...values) : 0;
  const maxRaw = values.length ? Math.max(...values) : 1;
  const range = maxRaw - minRaw || 1;
  const min = minRaw - range * 0.12;
  const max = maxRaw + range * 0.12;
  const coords = data.map((point, index) => ({
    x: padX + (index / Math.max(data.length - 1, 1)) * (width - padX * 2),
    y: padY + ((max - point.value) / Math.max(max - min, 1)) * (height - padY * 2),
  }));
  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const palette = {
    navy: "#17324d",
    red: "#b24a3a",
    green: "#18705a",
    gold: "#a97824",
  } as const;
  const latest = data.at(-1);

  return (
    <article className="rounded-2xl border border-slate-900/10 bg-white/55 p-4 dark:border-white/10 dark:bg-white/[0.025]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <p className="mt-1 text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)]">{unit}</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg font-semibold tabular-nums">{latest ? latest.value.toFixed(title.includes("非农") ? 0 : 1) : "—"}</div>
          <div className="text-[10px] text-[var(--text-tertiary)]">{latest?.date ?? "暂无"}</div>
        </div>
      </div>
      {data.length >= 2 ? (
        <svg className="mt-3 h-[126px] w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}最近 ${data.length} 个月趋势`}>
          <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="currentColor" strokeOpacity="0.1" />
          {min < 0 && max > 0 && (
            <line x1={padX} y1={padY + (max / (max - min)) * (height - padY * 2)} x2={width - padX} y2={padY + (max / (max - min)) * (height - padY * 2)} stroke="currentColor" strokeOpacity="0.16" strokeDasharray="3 4" />
          )}
          <path d={path} fill="none" stroke={palette[tone]} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {coords.map((point, index) => (
            <circle key={data[index].date} cx={point.x} cy={point.y} r={index === coords.length - 1 ? 3.5 : 2} fill={palette[tone]} opacity={index === coords.length - 1 ? 1 : 0.55} />
          ))}
        </svg>
      ) : (
        <div className="mt-3 flex h-[126px] items-center justify-center text-xs text-[var(--text-tertiary)]">趋势数据暂缺</div>
      )}
      <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--text-tertiary)]">
        <span>{data[0]?.date ?? "—"}</span>
        <span>{latest?.date ?? "—"}</span>
      </div>
    </article>
  );
}

function QuoteChange({ value }: { value: number | null }) {
  const positive = finite(value) && value > 0;
  const negative = finite(value) && value < 0;
  const text = finite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
  return <span className={`font-mono tabular-nums ${positive ? "text-emerald-600" : negative ? "text-rose-600" : "text-[var(--text-tertiary)]"}`}>{text}</span>;
}

function IndexCard({ quote }: { quote: UsQuote }) {
  return (
    <article className="border-l border-slate-900/15 py-2 pl-4 first:border-l-0 first:pl-0 dark:border-white/15 sm:first:border-l sm:first:pl-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--text-secondary)]">{quote.name}</span>
        <span className="font-mono text-[10px] text-[var(--text-tertiary)]">{quote.symbol}</span>
      </div>
      <div className="mt-3 font-mono text-2xl font-semibold tabular-nums tracking-tight">{formatPrice(quote.price)}</div>
      <div className="mt-1 text-xs"><QuoteChange value={quote.change_pct} /></div>
    </article>
  );
}

function SectorTable({ quotes }: { quotes: UsQuote[] }) {
  const sorted = [...quotes].sort((a, b) => (b.change_pct ?? -Infinity) - (a.change_pct ?? -Infinity));
  const maxAbs = Math.max(1, ...sorted.map((quote) => Math.abs(quote.change_pct ?? 0)));
  return (
    <div className="divide-y divide-slate-900/10 dark:divide-white/10">
      {sorted.map((quote, index) => {
        const pct = quote.change_pct;
        const width = finite(pct) ? Math.max(5, Math.abs(pct) / maxAbs * 100) : 0;
        return (
          <div key={quote.symbol} className="grid grid-cols-[1.75rem_minmax(0,1fr)_4rem] items-center gap-3 py-3">
            <span className="font-mono text-[10px] text-[var(--text-tertiary)]">{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium">{quote.name}</span>
                <span className="font-mono text-[10px] text-[var(--text-tertiary)]">{quote.symbol}</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-900/[0.06] dark:bg-white/[0.08]">
                <div className={`h-full rounded-full ${(pct ?? 0) >= 0 ? "bg-emerald-600" : "bg-rose-600"}`} style={{ width: `${width}%` }} />
              </div>
            </div>
            <div className="text-right text-sm"><QuoteChange value={pct} /></div>
          </div>
        );
      })}
    </div>
  );
}

function CompanyGrid({ quotes }: { quotes: UsQuote[] }) {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-slate-900/10 bg-slate-900/10 dark:border-white/10 dark:bg-white/10 sm:grid-cols-2">
      {quotes.map((quote) => (
        <article key={quote.symbol} className="bg-[var(--bg)] p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{quote.name}</span>
            <span className="font-mono text-[10px] text-[var(--text-tertiary)]">{quote.symbol}</span>
          </div>
          <div className="mt-4 flex items-end justify-between gap-3">
            <span className="font-mono text-xl font-semibold tabular-nums">${formatPrice(quote.price)}</span>
            <span className="shrink-0 text-xs"><QuoteChange value={quote.change_pct} /></span>
          </div>
        </article>
      ))}
    </div>
  );
}

export default function UsMarketDashboard({ initialData = null }: Props) {
  const [data, setData] = useState<UsMarketDashboardData | null>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const response = await fetch("/api/market/us", { cache: "no-store" });
      const payload = await response.json() as UsMarketDashboardData;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || `接口响应异常：${response.status}`);
      setData((current) => mergeUsMarketDashboardData(current, payload));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "网络异常");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      if (!document.hidden && isUsRegularMarketHours()) load();
    }, POLL_MS);
    const onVisibility = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const macro = data?.macro;
  const market = data?.market;
  const judgement = useMemo(() => deriveUsMacroJudgement({
    cpi: macro?.cpi ?? emptyMetric,
    payroll: macro?.payroll ?? emptyMetric,
    unemployment: macro?.unemployment ?? emptyMetric,
  }), [macro]);
  const badge = judgement.stance === "dovish"
    ? { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", ring: "border-emerald-500/25 bg-emerald-500/[0.07]" }
    : judgement.stance === "hawkish"
      ? { dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-400", ring: "border-rose-500/25 bg-rose-500/[0.07]" }
      : { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", ring: "border-amber-500/25 bg-amber-500/[0.07]" };

  if (!data) {
    return (
      <div className="space-y-4" aria-live="polite">
        <div className="h-48 animate-pulse rounded-[1.5rem] bg-[var(--bg-soft)]" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-72 animate-pulse rounded-[1.35rem] bg-[var(--bg-soft)]" />)}
        </div>
        {error && <p className="text-sm text-rose-600">美股数据加载失败：{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-12" aria-live="polite">
      <section aria-labelledby="us-thermometer-title">
        <div className="rounded-[1.6rem] border border-[#17324d]/15 bg-[#f4f1e8] px-5 py-7 text-[#13283b] shadow-[0_26px_80px_rgba(23,50,77,0.08)] dark:border-white/10 dark:bg-[#14202b] dark:text-[#edf4f7] sm:px-8 sm:py-9">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#b24a3a]">United States · Macro Pulse</p>
              <h2 id="us-thermometer-title" className="mt-3 font-serif text-3xl tracking-tight sm:text-4xl">🇺🇸 美国经济温度计</h2>
              <p className="mt-4 text-base leading-relaxed text-[#405467] dark:text-[#b8c7d2] sm:text-lg">
                当前状态：{judgement.employment} <span className="mx-1 text-[#a97824]">/</span> {judgement.inflation} <span className="mx-1 text-[#a97824]">/</span> {judgement.policy}
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-[#64748b] dark:text-[#9fb0bd]">
              <span className={`h-2 w-2 rounded-full ${loading ? "animate-pulse bg-amber-500" : isUsRegularMarketHours() ? "bg-emerald-500" : "bg-slate-400"}`} />
              {isUsRegularMarketHours() ? "纽约常规交易时段" : "纽约市场休市 / 盘外"}
            </div>
          </div>
        </div>

        {macro ? (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <MacroCard eyebrow="Inflation" title="CPI" metric={macro.cpi} formatter={(value) => formatPercent(value)} note="同比，未经季调" />
            <MacroCard eyebrow="Employment" title="非农" metric={macro.payroll} formatter={formatPayroll} note="就业人数月增量，季调" />
            <article className={`rounded-[1.35rem] border p-5 ${badge.ring}`}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">Combined Read</p>
              <div className="mt-4 flex items-center gap-3">
                <span className={`h-3 w-3 rounded-full ${badge.dot}`} />
                <h3 className={`text-3xl font-semibold tracking-tight ${badge.text}`}>{judgement.label}</h3>
              </div>
              <p className="mt-5 text-sm leading-7 text-[var(--text-secondary)]">{judgement.summary}</p>
              <div className="mt-5 border-t border-current/10 pt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                失业率 {formatPercent(macro.unemployment.actual)} · 核心 CPI {formatPercent(macro.core_cpi.actual)}
                {judgement.confidence === "limited" && <span className="ml-1 text-amber-700 dark:text-amber-400">· 低置信度</span>}
              </div>
            </article>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-rose-500/30 p-6 text-sm text-rose-700 dark:text-rose-300">美国宏观数据暂不可用。</div>
        )}
      </section>

      {macro && (
        <section aria-labelledby="us-trends-title">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#64748b]">12 Month Tape</p>
              <h2 id="us-trends-title" className="mt-1 text-2xl font-semibold tracking-tight">最近 12 个月趋势</h2>
            </div>
            <span className="text-[10px] text-[var(--text-tertiary)]">不同指标发布日期可能相差一个月</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TrendChart title="CPI" unit="同比 · %" data={macro.trends.cpi} tone="red" />
            <TrendChart title="核心 CPI" unit="同比 · %" data={macro.trends.core_cpi} tone="gold" />
            <TrendChart title="非农就业" unit="月增量 · 千人" data={macro.trends.payroll} tone="navy" />
            <TrendChart title="失业率" unit="季调 · %" data={macro.trends.unemployment} tone="green" />
          </div>
        </section>
      )}

      <section aria-labelledby="us-indices-title">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#64748b]">Market Benchmarks</p>
            <h2 id="us-indices-title" className="mt-1 text-2xl font-semibold tracking-tight">美股大盘</h2>
          </div>
          <span className="font-mono text-[10px] text-[var(--text-tertiary)]">延迟行情 · {formatQuoteTime(market?.quote_ts)}</span>
        </div>
        {market ? (
          <div className="grid grid-cols-1 gap-5 border-y border-slate-900/10 py-5 dark:border-white/10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
            {market.indices.map((quote) => <IndexCard key={quote.symbol} quote={quote} />)}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-rose-500/30 p-6 text-sm text-rose-700 dark:text-rose-300">美国市场行情暂不可用。</div>
        )}
      </section>

      {market && (
        <section className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" aria-label="热门板块和大型公司">
          <div>
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#64748b]">Sector Pulse</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">热门板块</h2>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">标普行业 ETF 当日涨跌排序</p>
            </div>
            <SectorTable quotes={market.sectors} />
          </div>
          <div>
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#64748b]">Mega Caps</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">大型公司</h2>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">核心科技与平台公司观察池</p>
            </div>
            <CompanyGrid quotes={market.companies} />
          </div>
        </section>
      )}

      <section className="border-t border-slate-900/10 pt-4 text-[11px] leading-6 text-[var(--text-tertiary)] dark:border-white/10" aria-label="数据来源和质量说明">
        <p>
          宏观实际值与历史序列：<a className="underline decoration-current/30 underline-offset-2 hover:text-[var(--text)]" href={macro?.source_url ?? "https://www.bls.gov/developers/api_signature_v2.htm"} target="_blank" rel="noreferrer">美国劳工统计局 BLS</a>
          {macro?.consensus?.source && <> · 一致预期：<a className="underline decoration-current/30 underline-offset-2 hover:text-[var(--text)]" href={macro.consensus.source_url ?? "https://tradingeconomics.com/united-states/calendar"} target="_blank" rel="noreferrer">{macro.consensus.source}</a></>}
          {market && <> · 行情：<a className="underline decoration-current/30 underline-offset-2 hover:text-[var(--text)]" href={market.source_url} target="_blank" rel="noreferrer">东方财富公开延迟行情</a></>}。
        </p>
        <p>
          {market?.partial && <span className="mr-2 text-amber-700 dark:text-amber-400">行情覆盖 {market.succeeded}/{market.requested}，缺失项保留为“—”。</span>}
          {(data.stale || macro?.stale || market?.stale) && <span className="mr-2 text-amber-700 dark:text-amber-400">当前使用最近一次成功缓存。</span>}
          {error && <span className="mr-2 text-amber-700 dark:text-amber-400">实时刷新失败：{error}。</span>}
          数据仅供研究记录，不构成投资建议。
        </p>
      </section>
    </div>
  );
}
