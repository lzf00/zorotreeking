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

export default function SearchModal() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

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

  return (
    <div role="dialog" aria-label="搜索" style={overlayStyle} onClick={() => setOpen(false)}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
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
            style={inputStyle}
          />
          <button onClick={() => setOpen(false)} aria-label="关闭" style={closeStyle}>Esc</button>
        </div>
        <div style={listStyle}>
          {loading && <div style={emptyStyle}>搜索中…</div>}
          {!loading && query && results.length === 0 && <div style={emptyStyle}>没有匹配结果</div>}
          {!loading && !query && <div style={emptyStyle}>输入关键词开始搜索 · 按 / 唤起 · Esc 关闭</div>}
          {results.map((r, i) => (
            <a key={i} href={r.url} style={resultStyle} onClick={() => setOpen(false)}>
              <div style={resultTitleStyle}>{r.meta?.title || r.url}</div>
              <div style={resultExcerptStyle} dangerouslySetInnerHTML={{ __html: r.excerpt }} />
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
const emptyStyle: React.CSSProperties = {
  padding: "32px 16px", textAlign: "center",
  fontSize: 13, color: "var(--text-tertiary, #9ca3af)",
};
