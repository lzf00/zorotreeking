import { useCallback, useEffect, useRef, useState } from "react";
import { postFeedback, type FeedbackState } from "@/lib/feedback-api";
import { EMPTY_STATE, getCached, loadFeedbackOrEmpty, putCached } from "@/lib/feedback-cache";

/**
 * 文章/digest 底部的点赞/踩按钮。微博风格：
 *   - 默认右对齐
 *   - 极小图标 + 数字
 *   - 乐观更新（点完立刻 +1，后台失败再回滚）
 *   - 失败时清晰提示状态码或错误类型
 *
 * Props:
 *   slug   唯一标识，约定 `{collection}/{translationKey}` 或 `item:<source>-<id>`
 *   align  "right"（默认）| "center"
 */

interface Props {
  slug: string;
  align?: "right" | "center";
}

export default function FeedbackButtons({ slug, align = "right" }: Props) {
  const [state, setState] = useState<FeedbackState | null>(null);
  const [pending, setPending] = useState(false);
  const [errCode, setErrCode] = useState<string | null>(null);

  // 不在这里拉取！digest 页面有 15–20 个按钮，挂载即请求会让一个页面开局就发
  // 21 个 GET（第 86 轮实测）。只在访客真的表现出兴趣时才拉：悬停 / 聚焦 /
  // 触摸 / 点击（见 ensureLoaded 上的事件），并且同一 slug 只拉一次。
  const stateRef = useRef<FeedbackState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    // 同一 slug 可能已有别的实例拉过（例如翻页缓存），命中就直接用
    const cached = slug ? getCached(slug) : null;
    if (cached) setState(cached);
  }, [slug]);

  // 加载失败后 30s 内不再重复请求（否则每次悬停都打一下坏接口）
  const failedAtRef = useRef(0);

  const ensureLoaded = useCallback(async (force = false) => {
    if (!slug || stateRef.current) return stateRef.current;
    if (!force && Date.now() - failedAtRef.current < 30_000) return EMPTY_STATE;

    // 永不抛错：线上 /api/feedback 的 GET 是 422，如果加载失败就让 vote() 直接
    // return，按钮会彻底点不动（点一下什么都不发生）。退化状态下 POST 照常发。
    const { state: fresh, degraded } = await loadFeedbackOrEmpty(slug);
    if (degraded) {
      failedAtRef.current = Date.now();
      console.warn("[feedback] 状态拉取失败，先用空状态（仍可投票）");
      setState(EMPTY_STATE);
      return EMPTY_STATE;
    }
    stateRef.current = fresh;
    failedAtRef.current = 0;
    setState(fresh);
    return fresh;
  }, [slug]);

  async function vote(target: "like" | "dislike") {
    if (pending) return;
    const current = state ?? (await ensureLoaded(true));
    if (!current) return;
    const next = current.my_vote === target ? "neutral" : target;

    // 乐观更新
    const optimistic: FeedbackState = computeOptimistic(current, target);
    const prev = current;
    setState(optimistic);
    setPending(true);
    setErrCode(null);

    try {
      const fresh = await postFeedback(slug, next);
      setState(fresh);
      putCached(slug, fresh);
    } catch (e: any) {
      // 回滚
      setState(prev);
      setErrCode(e?.message || "fetch-error");
    } finally {
      setPending(false);
    }
  }

  const likeActive = state?.my_vote === "like";
  const dislikeActive = state?.my_vote === "dislike";
  const likes = state?.likes ?? 0;
  const dislikes = state?.dislikes ?? 0;

  return (
    <div style={{ ...rowStyle, justifyContent: align === "right" ? "flex-end" : "center" }}>
      <button
        type="button"
        onClick={() => vote("like")}
        onPointerEnter={() => void ensureLoaded()}
        onFocus={() => void ensureLoaded()}
        onTouchStart={() => void ensureLoaded()}
        disabled={pending}
        style={btnStyle(likeActive, "var(--market-up)")}
        aria-pressed={likeActive}
        aria-label="喜欢"
        title="喜欢"
      >
        <svg width="13" height="13" viewBox="0 0 24 24"
          fill={likeActive ? "#dc2626" : "none"}
          stroke={likeActive ? "#dc2626" : "currentColor"}
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        {likes > 0 && <span style={numStyle}>{likes}</span>}
      </button>
      <button
        type="button"
        onClick={() => vote("dislike")}
        onPointerEnter={() => void ensureLoaded()}
        onFocus={() => void ensureLoaded()}
        onTouchStart={() => void ensureLoaded()}
        disabled={pending}
        style={btnStyle(dislikeActive, "#525252")}
        aria-pressed={dislikeActive}
        aria-label="不喜欢"
        title="不喜欢"
      >
        <svg width="13" height="13" viewBox="0 0 24 24"
          fill={dislikeActive ? "#525252" : "none"}
          stroke={dislikeActive ? "#525252" : "currentColor"}
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
        </svg>
        {dislikes > 0 && <span style={numStyle}>{dislikes}</span>}
      </button>
      {errCode && <span style={errStyle} title={errCode}>·{shortErr(errCode)}</span>}
    </div>
  );
}

function computeOptimistic(s: FeedbackState, target: "like" | "dislike"): FeedbackState {
  const was = s.my_vote;
  // 同一类型 → 取消
  if (was === target) {
    return {
      likes: target === "like" ? Math.max(0, s.likes - 1) : s.likes,
      dislikes: target === "dislike" ? Math.max(0, s.dislikes - 1) : s.dislikes,
      my_vote: null,
    };
  }
  // 不同类型或新投：先减旧票，再加新票
  let likes = s.likes;
  let dislikes = s.dislikes;
  if (was === "like") likes = Math.max(0, likes - 1);
  if (was === "dislike") dislikes = Math.max(0, dislikes - 1);
  if (target === "like") likes += 1;
  if (target === "dislike") dislikes += 1;
  return { likes, dislikes, my_vote: target };
}

function shortErr(code: string): string {
  if (code.startsWith("HTTP")) return code;
  if (code === "rate-limited") return "太快了";
  if (code === "fetch-error" || code.toLowerCase().includes("failed")) return "断网";
  return code.slice(0, 20);
}

// ── 紧凑内联样式（微博风：右对齐、灰色低存在感、hover 变亮）──
const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  margin: "8px 0 4px",
  fontSize: 12,
  color: "var(--text-tertiary, #9ca3af)",
  width: "100%",
};

const btnStyle = (active: boolean, color: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid transparent",
  background: active ? `${color}14` : "transparent",
  color: active ? color : "var(--text-tertiary, #9ca3af)",
  cursor: "pointer",
  fontSize: 12,
  fontFamily: "inherit",
  fontWeight: active ? 600 : 400,
  transition: "background 0.15s, color 0.15s",
  lineHeight: 1,
});

const numStyle: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  minWidth: 8,
};

const errStyle: React.CSSProperties = {
  // 主题变量而不是写死 #dc2626：暗底上 #dc2626 只有约 3:1，
  // 投票失败时那条 "·HTTP 404" 根本看不清（2026-11 axe 抓到）
  color: "var(--danger-text, #b91c1c)",
  fontSize: 11,
  cursor: "help",
};
