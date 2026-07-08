import { useEffect, useState } from "react";

/**
 * 访客留言板（无需登录）
 *
 * 后端：
 *   POST /api/guestbook  { nickname?, content, email?, website?, homepage? }
 *   GET  /api/guestbook?limit=&before=
 *
 * 反 spam：
 *   - website / homepage 蜜罐字段：CSS 隐藏；机器人会填 → 后端静默丢弃
 *   - 后端 IP 频率限制 5min/3 条 pending
 *   - 提交后前端显示"审核中"；只有 admin 通过后才在列表出现
 */

interface Props { lang?: "zh" | "en" }

interface Entry { id: number; ts: number; nickname: string; content: string }

const API = "/api/guestbook";
const PAGE = 20;

const TX = {
  zh: {
    formTitle: "写留言（无需登录）",
    nickname: "昵称",
    nicknamePh: "留空则显示「访客」",
    content: "留言内容",
    contentPh: "读了哪篇 · 觉得咋样 · 有啥建议 · 发现了 bug ……",
    email: "邮箱（可选）",
    emailPh: "留了我可以回你，不留也 OK",
    submit: "提交留言",
    submitting: "提交中……",
    sent: "已收到！审核通过后会显示在下方。",
    listTitle: "留言墙",
    empty: "还没有已通过的留言。做第一个吧。",
    loadMore: "加载更多",
    countPrefix: "共",
    countSuffix: "条已通过留言",
    tooShort: "留言太短了，至少 5 个字。",
    tooLong: "留言太长了，最多 2000 字。",
    invalidEmail: "邮箱格式看着不对。",
    rateLimited: "同一 IP 5 分钟内提交次数上限。喘口气再来。",
    submitFail: "提交失败：",
    charCount: "字",
    tip: "提交后进后台审核，不会立即公开显示。垃圾/骚扰内容会被拒。",
  },
  en: {
    formTitle: "Leave a message (no login)",
    nickname: "Name",
    nicknamePh: "Blank shows as \"Guest\"",
    content: "Message",
    contentPh: "Which post · what you think · a bug · anything…",
    email: "Email (optional)",
    emailPh: "Only used to reply — skip if you prefer.",
    submit: "Send",
    submitting: "Sending…",
    sent: "Got it! It'll show up here once I approve it.",
    listTitle: "Wall",
    empty: "No approved messages yet. Be the first.",
    loadMore: "Load more",
    countPrefix: "",
    countSuffix: "approved message(s)",
    tooShort: "Too short — at least 5 characters.",
    tooLong: "Too long — max 2000 characters.",
    invalidEmail: "That email doesn't look right.",
    rateLimited: "Too many submissions from your IP. Give it 5 minutes.",
    submitFail: "Submit failed: ",
    charCount: "chars",
    tip: "All submissions go through moderation before public display. Spam / abuse gets rejected.",
  },
} as const;

function formatTs(ts: number, lang: "zh" | "en"): string {
  const d = new Date(ts * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return lang === "en" ? `${y}-${m}-${dd} ${hh}:${mm}` : `${y}年${m}月${dd}日 ${hh}:${mm}`;
}

export default function GuestbookBoard({ lang = "zh" }: Props) {
  const t = TX[lang];
  const [items, setItems] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const [nickname, setNickname] = useState("");
  const [content, setContent] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [homepage, setHomepage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    let stopped = false;
    fetch(`${API}?limit=${PAGE}`)
      .then((r) => r.json())
      .then((data) => {
        if (stopped) return;
        setItems(data.items || []);
        setTotal(data.total || 0);
        setHasMore((data.items || []).length >= PAGE);
      })
      .catch(() => { if (!stopped) setNotice({ kind: "err", msg: "网络错误" }); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, []);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last) return;
    const r = await fetch(`${API}?limit=${PAGE}&before=${last.ts}`);
    const data = await r.json();
    setItems([...items, ...(data.items || [])]);
    setHasMore((data.items || []).length >= PAGE);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    const trimmed = content.trim();
    if (trimmed.length < 5) { setNotice({ kind: "err", msg: t.tooShort }); return; }
    if (trimmed.length > 2000) { setNotice({ kind: "err", msg: t.tooLong }); return; }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setNotice({ kind: "err", msg: t.invalidEmail }); return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: nickname.trim() || null,
          content: trimmed,
          email: email.trim() || null,
          website: website || null,
          homepage: homepage || null,
        }),
      });
      if (r.status === 429) { setNotice({ kind: "err", msg: t.rateLimited }); return; }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setNotice({ kind: "err", msg: t.submitFail + (data.error || `HTTP ${r.status}`) }); return; }
      setNotice({ kind: "ok", msg: t.sent });
      setContent(""); setEmail("");
    } catch (err: any) {
      setNotice({ kind: "err", msg: t.submitFail + (err?.message || "network") });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="rounded-lg border border-[var(--border)] p-5 bg-[var(--surface-1)] mb-6">
        <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)] font-mono mb-4">
          {t.formTitle}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">{t.nickname}</label>
            <input
              type="text"
              maxLength={32}
              value={nickname}
              onChange={(e) => setNickname((e.target as HTMLInputElement).value)}
              placeholder={t.nicknamePh}
              className="w-full rounded border border-[var(--border)] bg-[var(--surface-0,transparent)] px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">{t.email}</label>
            <input
              type="email"
              maxLength={128}
              value={email}
              onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
              placeholder={t.emailPh}
              className="w-full rounded border border-[var(--border)] bg-[var(--surface-0,transparent)] px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-xs text-[var(--text-secondary)] mb-1">
            {t.content}
            <span className="ml-2 text-[10px] text-[var(--text-tertiary)] font-mono">{content.length} / 2000 {t.charCount}</span>
          </label>
          <textarea
            rows={5}
            maxLength={2000}
            value={content}
            onChange={(e) => setContent((e.target as HTMLTextAreaElement).value)}
            placeholder={t.contentPh}
            className="w-full rounded border border-[var(--border)] bg-[var(--surface-0,transparent)] px-3 py-2 text-sm leading-relaxed focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* 蜜罐字段：正常用户看不到 */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", overflow: "hidden" }}>
          <label>Website<input type="text" tabIndex={-1} autoComplete="off"
            value={website} onChange={(e) => setWebsite((e.target as HTMLInputElement).value)} /></label>
          <label>Homepage<input type="text" tabIndex={-1} autoComplete="off"
            value={homepage} onChange={(e) => setHomepage((e.target as HTMLInputElement).value)} /></label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed max-w-md">{t.tip}</p>
          <button
            type="submit"
            disabled={submitting || content.trim().length < 5}
            className="rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2 transition-colors"
          >
            {submitting ? t.submitting : t.submit}
          </button>
        </div>

        {notice && (
          <div className={`mt-4 rounded p-3 text-sm ${
            notice.kind === "ok"
              ? "bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800"
          }`}>{notice.msg}</div>
        )}
      </form>

      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)] font-mono">
          {t.listTitle}
        </div>
        <div className="text-[11px] text-[var(--text-tertiary)] font-mono">
          {t.countPrefix}{total} {t.countSuffix}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--text-tertiary)] italic">…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)] italic border border-dashed border-[var(--border)] rounded p-6 text-center">
          {t.empty}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.id} className="rounded-lg border border-[var(--border)] p-4">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="text-sm font-semibold">{it.nickname}</span>
                <time className="text-[11px] text-[var(--text-tertiary)] font-mono">{formatTs(it.ts, lang)}</time>
              </div>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap break-words">
                {it.content}
              </p>
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={loadMore}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text)] border border-[var(--border)] rounded px-4 py-1.5"
          >{t.loadMore}</button>
        </div>
      )}
    </div>
  );
}
