import { useEffect, useState } from "react";

/**
 * 5 星评分（hover 预览 / click 落地）。
 *
 * 后端复用现有 /api/feedback（kind: like|dislike|neutral）做汇总。
 * 映射：1-2 ⭐ → dislike，3 ⭐ → neutral，4-5 ⭐ → like。
 * 客户端保留精确的 1-5 分（localStorage），下次进来直接亮原星数。
 *
 * Props:
 *   slug   `{collection}/{translationKey}` 或 `item:<source>-<id>`
 *   align  "right"（默认）| "center"
 *   label  星组左侧的小提示文案，默认 "评分"
 */
interface Props {
  slug: string;
  align?: "right" | "center";
  label?: string;
}

type FeedbackState = {
  likes: number;
  dislikes: number;
  my_vote: "like" | "dislike" | null;
};

type Score = 1 | 2 | 3 | 4 | 5;

const API_BASE = "/api/feedback";
const LS_KEY = (slug: string) => `zoro:rating:${slug}`;

function scoreToKind(score: Score): "like" | "dislike" | "neutral" {
  if (score >= 4) return "like";
  if (score <= 2) return "dislike";
  return "neutral";
}

async function fetchFeedback(slug: string, signal?: AbortSignal): Promise<FeedbackState> {
  const r = await fetch(`${API_BASE}?slug=${encodeURIComponent(slug)}`, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as FeedbackState;
}

async function postFeedback(slug: string, kind: "like" | "dislike" | "neutral"): Promise<FeedbackState> {
  const r = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, kind }),
  });
  if (r.status === 429) throw new Error("rate-limited");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as FeedbackState;
}

const LABELS: Record<Score, string> = {
  1: "差强人意",
  2: "一般",
  3: "还行",
  4: "不错",
  5: "极好",
};

export default function StarRating({ slug, align = "right", label = "评分" }: Props) {
  const [agg, setAgg] = useState<FeedbackState | null>(null);
  const [hover, setHover] = useState<Score | 0>(0);
  const [score, setScore] = useState<Score | 0>(0);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 初始：localStorage + 后端汇总
  useEffect(() => {
    if (!slug) return;
    try {
      const cached = localStorage.getItem(LS_KEY(slug));
      const n = cached ? parseInt(cached, 10) : 0;
      if (n >= 1 && n <= 5) setScore(n as Score);
    } catch {}
    const ctl = new AbortController();
    fetchFeedback(slug, ctl.signal)
      .then(setAgg)
      .catch((e) => {
        if (e.name === "AbortError") return;
        setErr(e.message || "fetch-error");
        setAgg({ likes: 0, dislikes: 0, my_vote: null });
      });
    return () => ctl.abort();
  }, [slug]);

  async function rate(n: Score) {
    if (pending) return;
    const prevScore = score;
    setScore(n);
    setPending(true);
    setErr(null);
    try {
      localStorage.setItem(LS_KEY(slug), String(n));
    } catch {}
    try {
      const fresh = await postFeedback(slug, scoreToKind(n));
      setAgg(fresh);
    } catch (e: any) {
      setScore(prevScore);
      setErr(e?.message || "fetch-error");
    } finally {
      setPending(false);
    }
  }

  const display = hover || score;
  const totalVotes = (agg?.likes ?? 0) + (agg?.dislikes ?? 0);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      justifyContent: align === "right" ? "flex-end" : "center",
      flexWrap: "wrap",
      margin: "8px 0 4px",
      fontSize: 12,
      color: "var(--text-tertiary, #9ca3af)",
    }}>
      <span style={{ fontFamily: "inherit", letterSpacing: "0.04em" }}>{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        onMouseLeave={() => setHover(0)}
        style={{ display: "inline-flex", gap: 2 }}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= display;
          const active = display !== 0;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={score === n}
              aria-label={`${n} 星 · ${LABELS[n as Score]}`}
              disabled={pending}
              onMouseEnter={() => setHover(n as Score)}
              onFocus={() => setHover(n as Score)}
              onClick={() => rate(n as Score)}
              style={{
                background: "transparent",
                border: "none",
                padding: "2px 1px",
                cursor: pending ? "wait" : "pointer",
                lineHeight: 1,
                color: filled
                  ? (display >= 4 ? "#f59e0b" : display >= 3 ? "#fbbf24" : "#9ca3af")
                  : "var(--text-tertiary, #d4d4d8)",
                opacity: active ? 1 : 0.55,
                transition: "color 0.15s, opacity 0.15s, transform 0.1s",
                transform: hover === n ? "scale(1.18)" : "scale(1)",
              }}
              title={LABELS[n as Score]}
            >
              <svg width="16" height="16" viewBox="0 0 24 24"
                fill={filled ? "currentColor" : "none"}
                stroke="currentColor" strokeWidth="1.8"
                strokeLinejoin="round" strokeLinecap="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </button>
          );
        })}
      </div>
      {display > 0 && (
        <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 28 }}>
          {LABELS[display as Score]}
        </span>
      )}
      {totalVotes > 0 && (
        <span style={{ opacity: 0.7 }}>
          · {totalVotes} 人评 · 👍 {agg!.likes}
        </span>
      )}
      {err && (
        <span style={{ color: "#dc2626", cursor: "help" }} title={err}>
          · {err.startsWith("HTTP") ? err : err === "rate-limited" ? "太快" : "断网"}
        </span>
      )}
    </div>
  );
}
