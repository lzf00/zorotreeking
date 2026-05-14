import { useEffect, useState } from "react";

/**
 * 文章底部的点赞/踩按钮（类似微博）。
 *
 * - slug：唯一标识，约定 `{collection}/{translationKey}`（如 "ai/digest-2026-05-14"）
 * - 状态从 GET /api/feedback?slug=... 拉取
 * - 点击切换发送 POST /api/feedback {slug, kind}
 * - kind: "like" | "dislike" | "neutral"（neutral 表示取消投票）
 * - 后端按 IP+UA 指纹去重
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
    // 切换逻辑：再次点击当前类型 → neutral；否则切到目标类型
    const next = state.my_vote === target ? "neutral" : target;
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, kind: next }),
      });
      if (r.status === 429) {
        setErr("点得太快了，稍等一下");
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

  if (state === null && err === null) {
    return <div style={loadingStyle}>加载反馈状态…</div>;
  }

  const likeActive = state?.my_vote === "like";
  const dislikeActive = state?.my_vote === "dislike";

  return (
    <div style={wrapperStyle}>
      <div style={questionStyle}>读完觉得如何？</div>
      <div style={buttonsRowStyle}>
        <button
          type="button"
          onClick={() => vote("like")}
          disabled={busy}
          style={buttonStyle(likeActive, "#dc2626")}
          aria-pressed={likeActive}
          aria-label="喜欢"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={likeActive ? "#dc2626" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          <span style={countStyle}>{state?.likes ?? 0}</span>
        </button>
        <button
          type="button"
          onClick={() => vote("dislike")}
          disabled={busy}
          style={buttonStyle(dislikeActive, "#6b7280")}
          aria-pressed={dislikeActive}
          aria-label="不喜欢"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={dislikeActive ? "#6b7280" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
          </svg>
          <span style={countStyle}>{state?.dislikes ?? 0}</span>
        </button>
      </div>
      {err && <div style={errStyle}>反馈出错：{err}</div>}
    </div>
  );
}

// ── inline styles（保持组件自包含；不依赖 Tailwind classname） ──
const wrapperStyle: React.CSSProperties = {
  margin: "32px auto 16px",
  padding: "20px 24px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 14,
  textAlign: "center",
  maxWidth: 420,
  background: "var(--bg-soft, #f7f8fa)",
};

const questionStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary, #6b7280)",
  marginBottom: 12,
};

const buttonsRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  justifyContent: "center",
};

const buttonStyle = (active: boolean, color: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 18px",
  borderRadius: 999,
  border: `1.5px solid ${active ? color : "var(--border, #e5e7eb)"}`,
  background: active ? `${color}14` : "var(--bg, #fff)",
  color: active ? color : "var(--text, #111827)",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 500,
  fontFamily: "inherit",
  transition: "all 0.15s",
  minWidth: 88,
  justifyContent: "center",
});

const countStyle: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontWeight: 600,
};

const loadingStyle: React.CSSProperties = {
  textAlign: "center",
  fontSize: 12,
  color: "var(--text-tertiary, #9ca3af)",
  padding: 16,
};

const errStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: "#dc2626",
};
