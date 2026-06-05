import { useEffect, useState } from "react";

/**
 * 文章页浮动右侧分享栏。仅 xl 屏（≥1280px）显示，不打扰移动端阅读。
 *
 * 4 个按钮：复制链接 / Twitter 分享 / 微信二维码（点开 modal）/ 顶部
 * 设计：极小图标，垂直 stack；hover 显示文字 tooltip。
 *
 * 微信分享：弹出 modal 显示当前 URL 的二维码（用 qrcode-svg 之类轻量库；
 * 这里直接用 SVG 在客户端生成，避免引依赖）。
 */
interface Props {
  title: string;
  url: string;     // 当前页 canonical URL
}

export default function ShareSidebar({ title, url }: Props) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollTop(window.scrollY || 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 滚过 hero 才出现
  const visible = scrollTop > 400;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 降级：选中文本提示用户手动复制
      window.prompt("复制链接", url);
    }
  }

  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;

  const btnBase: React.CSSProperties = {
    width: 36, height: 36, borderRadius: 18,
    display: "flex", alignItems: "center", justifyContent: "center",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    cursor: "pointer",
    transition: "all 0.15s",
  };

  return (
    <>
      <aside
        aria-label="分享文章"
        style={{
          position: "fixed",
          right: 24,
          top: "50%",
          transform: `translateY(-50%) ${visible ? "translateX(0)" : "translateX(80px)"}`,
          opacity: visible ? 1 : 0,
          transition: "transform 0.25s ease-out, opacity 0.25s",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 30,
          pointerEvents: visible ? "auto" : "none",
        }}
        className="hidden xl:flex">
        <button onClick={copyLink} style={btnBase} aria-label="复制链接" title={copied ? "已复制" : "复制链接"}>
          {copied ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          )}
        </button>

        <a href={twitterUrl} target="_blank" rel="noopener noreferrer" style={btnBase} aria-label="分享到 Twitter" title="分享到 Twitter">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>

        <button onClick={() => setQrOpen(true)} style={btnBase} aria-label="微信扫码分享" title="微信分享">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 13.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm7 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2zM12 2C6.48 2 2 5.84 2 10.5c0 2.65 1.46 5.02 3.77 6.58l-.49 2.27c-.06.27.23.5.48.36L8.4 18.5c1.13.27 2.34.42 3.6.42 5.52 0 10-3.84 10-8.5S17.52 2 12 2z"/></svg>
        </button>

        <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                style={btnBase} aria-label="回到顶部" title="回到顶部">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
      </aside>

      {/* 微信二维码 modal */}
      {qrOpen && (
        <div role="dialog" aria-modal="true"
             onClick={() => setQrOpen(false)}
             style={{
               position: "fixed", inset: 0, zIndex: 100,
               background: "rgba(0,0,0,0.55)",
               display: "flex", alignItems: "center", justifyContent: "center",
             }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{
                 background: "var(--bg)",
                 borderRadius: 16,
                 padding: 24,
                 maxWidth: 320,
                 width: "calc(100% - 32px)",
                 textAlign: "center",
                 boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
               }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>微信扫码分享</div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 16 }}>
              手机微信【发现】→【扫一扫】
            </div>
            <div style={{
              background: "white", padding: 12, borderRadius: 12, display: "inline-block",
            }}>
              <img
                width="200" height="200" alt="QR code"
                src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`}
              />
            </div>
            <div style={{ marginTop: 14, fontSize: 11, color: "var(--text-tertiary)", wordBreak: "break-all" }}>{url}</div>
            <button onClick={() => setQrOpen(false)}
                    style={{
                      marginTop: 16, padding: "6px 14px", fontSize: 12,
                      borderRadius: 999, border: "1px solid var(--border)",
                      background: "transparent", cursor: "pointer",
                    }}>
              关闭
            </button>
          </div>
        </div>
      )}
    </>
  );
}
