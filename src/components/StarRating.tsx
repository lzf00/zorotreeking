import { useCallback, useEffect, useRef, useState } from "react";
import { postFeedback, type FeedbackState } from "@/lib/feedback-api";
import { EMPTY_STATE, loadFeedbackOrEmpty, putCached } from "@/lib/feedback-cache";

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

type Score = 1 | 2 | 3 | 4 | 5;

const LS_KEY = (slug: string) => `zoro:rating:${slug}`;

function scoreToKind(score: Score): "like" | "dislike" | "neutral" {
  if (score >= 4) return "like";
  if (score <= 2) return "dislike";
  return "neutral";
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

  // 挂载只读本地记忆（不发请求）。汇总数改为「访客真的对星星感兴趣时」再拉：
  //   - 线上 /api/feedback 的 GET 是 422，挂载即拉会让每篇文章底部出现红色 "· HTTP 422"
  //     （第 83 轮在 FeedbackButtons 上修过一次，这里是同一个坑的另一半）
  //   - 评分数只是信任信号，晚几百毫秒出现没关系
  const failedAtRef = useRef(0);
  const aggRef = useRef<FeedbackState | null>(null);
  aggRef.current = agg;
  const ensureLoaded = useCallback(async () => {
    if (!slug || aggRef.current) return aggRef.current;
    if (Date.now() - failedAtRef.current < 30_000) return EMPTY_STATE;
    const { state: fresh, degraded } = await loadFeedbackOrEmpty(slug);
    if (degraded) {
      failedAtRef.current = Date.now();
      // 静默：访客还没评分，不该看到错误徽标；真正评分失败才提示
      console.warn("[rating] 汇总数据拉取失败，先用空状态");
      setAgg(EMPTY_STATE);
      return EMPTY_STATE;
    }
    failedAtRef.current = 0;
    setAgg(fresh);
    return fresh;
  }, [slug]);


  useEffect(() => {
    if (!slug) return;
    try {
      const cached = localStorage.getItem(LS_KEY(slug));
      const n = cached ? parseInt(cached, 10) : 0;
      if (n >= 1 && n <= 5) setScore(n as Score);
    } catch {}
  }, [slug]);

  async function rate(n: Score) {
    if (pending) return;
    const prevScore = score;
    setScore(n);
    setPending(true);
    setErr(null);
    try {
      const fresh = await postFeedback(slug, scoreToKind(n));
      setAgg(fresh);
      putCached(slug, fresh);
      try {
        localStorage.setItem(LS_KEY(slug), String(n));
      } catch {}
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
        style={{ display: "inline-flex" }}
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
              onMouseEnter={() => { setHover(n as Score); void ensureLoaded(); }}
              onFocus={() => { setHover(n as Score); void ensureLoaded(); }}
              onTouchStart={() => void ensureLoaded()}
              onClick={() => rate(n as Score)}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                width: 44,
                height: 44,
                display: "grid",
                placeItems: "center",
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
        <span style={{ color: "var(--market-up)", cursor: "help" }} title={err}>
          · {err.startsWith("HTTP") ? err : err === "rate-limited" ? "太快" : "断网"}
        </span>
      )}
    </div>
  );
}
