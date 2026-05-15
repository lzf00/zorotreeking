import { useEffect, useState } from "react";

/**
 * 文章/digest 底部的点赞/踩按钮（微博风格 · 紧凑 inline）。
 *
 *   slug：唯一标识，约定 `{collection}/{translationKey}` 或 `item:<source>-<id>`
 *   GET  /api/feedback?slug=...
 *   POST /api/feedback {slug, kind: "like"|"dislike"|"neutral"}
 *
 *   - 后端按 IP+UA 指纹去重
 *   - 再点同一个按钮 = 取消投票（kind: neutral）
 */

type FeedbackState = {
  likes: number;
  dislikes: number;
  my_vote: "like" | "dislike" | null;
};

interface Props {
  slug: string;
}

export default function FeedbackButtons({ slug }: Props) {
  const [state, setState] = useState<FeedbackState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/feedback?slug=${encodeURIComponent(slug)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as FeedbackState;
        if (!cancelled) setState(data);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  async function vote(target: "like" | "dislike") {
    if (busy || !state) return;
    setBusy(true);
    const next = state.my_vote === target ? "neutral" : target;
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, kind: next }),
      });
      if (r.status === 429) {
        setErr("点得太快了");
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as FeedbackState;
      setState(data);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // 加载中保持占位，避免布局跳动
  const likes = state?.likes ?? 0;
  const dislikes = state?.dislikes ?? 0;
  const likeActive = state?.my_vote === "like";
  const dislikeActive = state?.my_vote === "dislike";

  return (
    <div style={rowStyle}>
      <button
        type="button"
        onClick={() => vote("like")}
        disabled={busy || !state}
        style={btnStyle(likeActive, "#dc2626")}
        aria-pressed={likeActive}
        aria-label="喜欢"
      >
        <svg width="14" height="14" viewBox="0 0 24 24"
          fill={likeActive ? "#dc2626" : "none"}
          stroke={likeActive ? "#dc2626" : "currentColor"}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        <span style={numStyle}>{likes}</span>
      </button>
      <button
        type="button"
        onClick={() => vote("dislike")}
        disabled={busy || !state}
        style={btnStyle(dislikeActive, "#525252")}
        aria-pressed={dislikeActive}
        aria-label="不喜欢"
      >
        <svg width="14" height="14" viewBox="0 0 24 24"
          fill={dislikeActive ? "#525252" : "none"}
          stroke={dislikeActive ? "#525252" : "currentColor"}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
        </svg>
        <span style={numStyle}>{dislikes}</span>
      </button>
      {err && <span style={errStyle}>· {err}</span>}
    </div>
  );
}

// ── 紧凑内联样式（不带 card 背景，只有图标+数字）──
const rowStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  margin: "8px 0",
  fontSize: 12.5,
  color: "var(--text-tertiary, #9ca3af)",
};

const btnStyle = (active: boolean, color: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 9px",
  borderRadius: 999,
  border: "1px solid transparent",
  background: active ? `${color}10` : "transparent",
  color: active ? color : "var(--text-tertiary, #9ca3af)",
  cursor: "pointer",
  fontSize: 12.5,
  fontFamily: "inherit",
  transition: "background 0.15s, color 0.15s",
  lineHeight: 1,
});

const numStyle: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  minWidth: 8,
};

const errStyle: React.CSSProperties = {
  color: "#dc2626",
  fontSize: 11,
};
