import DOMPurify from "dompurify";
import { useEffect, useRef, useState } from "react";

/**
 * 全站搜索 modal（pagefind 客户端全文检索）。
 * - pagefind 索引在 build 期生成到 dist/pagefind/
 * - 运行时动态 import('/pagefind/pagefind.js')
 * - 顶栏点放大镜或按 / 触发
 */

type Result = {
  url: string;
  excerpt: string;
  meta: { title?: string };
  filters?: Record<string, string[]>;
};

declare global {
  interface Window {
    pagefind?: {
      search: (q: string) => Promise<{ results: Array<{ id: string; data: () => Promise<Result> }> }>;
      init?: () => Promise<void>;
    };
  }
}

type SearchModalProps = {
  /** 弹窗模式默认关着；`/search/` 页面模式直接展开。 */
  initialOpen?: boolean;
  /** 深链 `/search/?q=…` 带进来的关键词。 */
  initialQuery?: string;
  /**
   * `modal`（默认）：全站浮层；`page`：`/search/` 专用，铺在页面里而不是盖在页面上，
   * 并且把关键词同步回地址栏，这样"搜到了什么"可以分享、刷新、后退。
   */
  variant?: "modal" | "page";
};

export default function SearchModal({ initialOpen = false, initialQuery = "", variant = "modal" }: SearchModalProps = {}) {
  const isPage = variant === "page";
  const [open, setOpen] = useState(initialOpen || isPage);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // 打开前焦点在哪（放大镜 / 首页搜索框 / 404 页的"直接搜索"），关闭时要还回去。
  // 第 140 轮之前没有这一步：关掉弹窗后焦点掉到 <body>，键盘用户得从头 Tab 一遍。
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // 全局快捷键：/ 打开，Esc 关闭
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "/" && !open) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          e.preventDefault();
          setOpen(true);
        }
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // 暴露给 Navbar 按钮触发
  useEffect(() => {
    (window as any).__openSearch = () => setOpen(true);
  }, []);

  /**
   * `/search/` 的深链（第 187 轮）。
   *
   * 之前站内只有浮层搜索：`/search/` 直接 404，搜到的词也没法分享或后退回去
   * （结果全在 React state 里）。页面模式把 `?q=` 当唯一事实来源：
   * 进来先读一次，之后每次输入 `replaceState` 写回 —— 不产生历史垃圾，但可以复制链接。
   */
  useEffect(() => {
    if (!isPage) return;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("q");
    if (fromUrl && !initialQuery) setQuery(fromUrl);
  }, [isPage, initialQuery]);

  useEffect(() => {
    if (!isPage) return;
    const params = new URLSearchParams(window.location.search);
    if (query.trim()) params.set("q", query);
    else params.delete("q");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState(null, "", next);
  }, [isPage, query]);

  // 打开时记住来源焦点并聚焦输入框；关闭时把焦点还回原处
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      window.clearTimeout(timer);
      const target = restoreFocusRef.current;
      if (target && document.contains(target)) target.focus();
    };
  }, [open]);

  /**
   * 焦点陷阱（第 140 轮）。
   *
   * 实测：弹窗打开后按两次 Tab，焦点就跑到背后的页面链接上了 —— 屏幕阅读器和纯键盘
   * 用户会"掉出"对话框，而 `aria-modal` 又不在，辅助技术也不会把背景当作不可交互。
   * 这里在 Tab / Shift+Tab 到边界时把焦点绕回另一端。
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])',
    );
    const focusable = Array.from(nodes ?? []).filter((node) => node.offsetParent !== null || node === document.activeElement);
    // 只有一个可聚焦元素时**不能**做焦点陷阱：Tab 会被"绕回自己"，焦点永远出不去。
    // （第 187 轮实测：`/search/` 空结果时唯一可聚焦的就是输入框，Tab 完全卡死。）
    if (focusable.length < 2) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  // 搜索
  useEffect(() => {
    if (!open || !query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (!window.pagefind) {
          // pagefind 索引在 build 期由 pagefind CLI 写入 dist/pagefind/
          // 必须运行时拼字符串，避免 rollup 试图静态解析 URL
          const url = "/" + "pagefind/pagefind.js";
          // @ts-ignore
          const mod = await import(/* @vite-ignore */ url);
          window.pagefind = mod;
          await mod.init?.();
        }
        const search = await window.pagefind!.search(query);
        const items = await Promise.all(search.results.slice(0, 10).map((r) => r.data()));
        if (!cancelled) setResults(items);
      } catch (e) {
        console.warn("[search] failed", e);
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, query]);

  if (!open) return null;

  if (isPage) {
    return (
      <div
        ref={dialogRef}
        role="search"
        aria-label="站内搜索"
        style={pageShellStyle}
      >
        <div style={inputWrapStyle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--text-tertiary, #9ca3af)" }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文章、digest、笔记…"
            aria-label="输入搜索关键词"
            style={inputStyle}
          />
        </div>
        <div style={listStyle}>
          <div role="status" aria-live="polite" style={srOnlyStyle}>
            {loading ? "搜索中" : query ? `${results.length} 条结果` : ""}
          </div>
          {loading && <div style={emptyStyle}>搜索中…</div>}
          {!loading && query && results.length === 0 && <div style={emptyStyle}>没有匹配结果</div>}
          {!loading && !query && <div style={emptyStyle}>输入关键词开始搜索（也可以按 / 唤起浮层）</div>}
          {results.map((r, i) => (
            <a key={i} href={r.url} style={resultStyle}>
              <div style={resultTitleStyle}>{r.meta?.title || r.url}</div>
              <div
                style={resultExcerptStyle}
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(r.excerpt, {
                    ALLOWED_TAGS: ["mark", "strong", "em", "code", "span"],
                    ALLOWED_ATTR: [],
                  }),
                }}
              />
            </a>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle} onClick={() => setOpen(false)}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="站内搜索"
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div style={inputWrapStyle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--text-tertiary, #9ca3af)" }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文章、digest、笔记…"
            aria-label="输入搜索关键词"
            style={inputStyle}
          />
          <button onClick={() => setOpen(false)} aria-label="关闭" style={closeStyle}>Esc</button>
        </div>
        <div style={listStyle}>
          {/* 结果变化要让屏幕阅读器知道；视觉上不占位（下面还有可见状态文案） */}
          <div role="status" aria-live="polite" style={srOnlyStyle}>
            {loading ? "搜索中" : query ? `${results.length} 条结果` : ""}
          </div>
          {loading && <div style={emptyStyle}>搜索中…</div>}
          {!loading && query && results.length === 0 && <div style={emptyStyle}>没有匹配结果</div>}
          {!loading && !query && <div style={emptyStyle}>输入关键词开始搜索 · 按 / 唤起 · Esc 关闭</div>}
          {/* 浮层只给前 10 条；把"全部结果"这条路接上真实页面（第 187 轮）：
              之前搜到一半想细看只能自己改地址栏，`/search/` 上线后可以一键跳过去。 */}
          {!loading && query.trim() && (
            <a
              href={`/search/?q=${encodeURIComponent(query.trim())}`}
              style={moreStyle}
              onClick={() => setOpen(false)}
            >
              在搜索页查看全部结果 →
            </a>
          )}
          {results.map((r, i) => (
            <a key={i} href={r.url} style={resultStyle} onClick={() => setOpen(false)}>
              <div style={resultTitleStyle}>{r.meta?.title || r.url}</div>
              <div
                style={resultExcerptStyle}
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(r.excerpt, {
                    ALLOWED_TAGS: ["mark", "strong", "em", "code", "span"],
                    ALLOWED_ATTR: [],
                  }),
                }}
              />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── styles ──
const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 9999,
  background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  paddingTop: "10vh", paddingLeft: 16, paddingRight: 16,
};
const moreStyle: React.CSSProperties = {
  display: "block", padding: "10px 14px", marginTop: 4,
  borderRadius: 8, fontSize: 13, color: "var(--text-secondary, #52525b)",
  textDecoration: "none", borderTop: "1px solid var(--border, #e5e7eb)",
};
const pageShellStyle: React.CSSProperties = {
  width: "100%", background: "var(--bg, #fff)",
  border: "1px solid var(--border, #e5e7eb)", borderRadius: 14,
  display: "flex", flexDirection: "column", overflow: "hidden",
};
const modalStyle: React.CSSProperties = {
  width: "min(640px, 100%)", background: "var(--bg, #fff)",
  border: "1px solid var(--border, #e5e7eb)", borderRadius: 14,
  boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  display: "flex", flexDirection: "column",
  maxHeight: "75vh", overflow: "hidden",
};
const inputWrapStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10,
  padding: "14px 16px",
  borderBottom: "1px solid var(--border-soft, #f0f1f3)",
};
const inputStyle: React.CSSProperties = {
  flex: 1, border: "none", outline: "none",
  fontSize: 15, fontFamily: "inherit",
  background: "transparent", color: "var(--text, #111827)",
};
const closeStyle: React.CSSProperties = {
  padding: "2px 8px", fontSize: 11,
  border: "1px solid var(--border, #e5e7eb)", borderRadius: 6,
  background: "var(--bg-soft, #f7f8fa)", color: "var(--text-tertiary, #9ca3af)",
  cursor: "pointer", fontFamily: "inherit",
};
const listStyle: React.CSSProperties = {
  flex: 1, overflowY: "auto", padding: "8px 0",
};
const resultStyle: React.CSSProperties = {
  display: "block", padding: "10px 16px",
  textDecoration: "none", color: "var(--text, #111827)",
  borderBottom: "1px solid var(--border-soft, #f0f1f3)",
};
const resultTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, marginBottom: 3,
};
const resultExcerptStyle: React.CSSProperties = {
  fontSize: 12.5, color: "var(--text-secondary, #6b7280)",
  lineHeight: 1.55,
};
const srOnlyStyle: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
};
const emptyStyle: React.CSSProperties = {
  padding: "32px 16px", textAlign: "center",
  fontSize: 13, color: "var(--text-tertiary, #9ca3af)",
};
