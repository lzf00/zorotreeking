import { useEffect, useRef, useState } from "react";
import { marked } from "marked";

/**
 * 悬浮 AI 聊天泡泡。挂在 BaseLayout，全站可见。
 * - 后端：FastAPI（部署在腾讯云，nginx 反代 /api/*）
 * - 本地 dev：vite proxy 把 /api/* 转到 localhost:8800
 * - 限流：nginx 端 IP-based（chat 20/min）
 */

type Source = {
  title?: string;
  url?: string;
  snippet?: string;
  site?: string;
};
type Intent = {
  intent?: string;
  intent_label?: string;
  intent_emoji?: string;
};
type Message = {
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  sources?: Source[];
  intent?: Intent;
  error?: boolean;
};

const SESSION_KEY = "zoro-chat-session";
const HISTORY_KEY = "zoro-chat-history";
const MODEL_KEY = "zoro-chat-model";

const SUGGESTED = ["这个站是关于什么的？", "今日股市行情", "今日 AI 资讯"];

type ModelsInfo = {
  models: string[];
  default: string;
};

marked.setOptions({ breaks: true, gfm: true });

function renderMd(text: string): string {
  try {
    return marked.parse(text || "") as string;
  } catch {
    return text;
  }
}

export default function AIChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [unread, setUnread] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState<string>("Kimi-K2.5");
  const sessionId = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 加载历史 + 模型列表
  useEffect(() => {
    try {
      const sid = localStorage.getItem(SESSION_KEY) || "";
      const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as Message[];
      sessionId.current = sid;
      if (hist.length) setMessages(hist);
      const saved = localStorage.getItem(MODEL_KEY) || "";
      if (saved) setCurrentModel(saved);
    } catch {}
    fetch("/api/models")
      .then((r) => r.json() as Promise<ModelsInfo>)
      .then((info) => {
        if (info.models && info.models.length) {
          setModels(info.models);
          // 没存过偏好就用 default
          const saved = localStorage.getItem(MODEL_KEY) || "";
          if (!saved && info.default) setCurrentModel(info.default);
        }
      })
      .catch(() => {});
  }, []);

  // 保存历史
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-50)));
    } catch {}
  }, [messages]);

  // 自动滚到底
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  // 打开面板时清未读
  useEffect(() => {
    if (open) setUnread(false);
  }, [open]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    const userMsg: Message = { role: "user", text: msg };
    setMessages((prev) => [...prev, userMsg, { role: "assistant", text: "" }]);
    setInput("");

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId.current,
          message: msg,
          model: currentModel,
          web_search: webSearch,
        }),
      });
      if (resp.status === 429) {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", text: "请慢一点，每分钟最多 20 次。", error: true };
          return next;
        });
        return;
      }
      if (!resp.body) throw new Error("no body");
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let contentBuf = "";
      let reasoningBuf = "";
      let sources: Source[] | undefined;
      let intent: Intent | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const obj = JSON.parse(data);
            if (obj.session_id) {
              sessionId.current = obj.session_id;
              try { localStorage.setItem(SESSION_KEY, obj.session_id); } catch {}
            }
            if (obj.type === "sources") {
              sources = obj.sources || [];
              if (obj.intent) {
                intent = { intent: obj.intent, intent_label: obj.intent_label, intent_emoji: obj.intent_emoji };
              }
            } else if (obj.type === "reasoning" && obj.text) {
              reasoningBuf += obj.text;
            } else if (obj.type === "content" && obj.text) {
              contentBuf += obj.text;
            } else if (obj.type === "error") {
              throw new Error(obj.text || "服务器错误");
            }
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                role: "assistant",
                text: contentBuf,
                reasoning: reasoningBuf || undefined,
                sources,
                intent,
              };
              return next;
            });
          } catch (e) {
            // 单个 chunk 解析失败，跳过
            if (e instanceof Error && e.message !== "Unexpected end of JSON input") {
              console.error("[chat] parse error:", e);
            }
          }
        }
      }
      if (!open) setUnread(true);
    } catch (e: any) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", text: `请求失败：${e.message || e}`, error: true };
        return next;
      });
    } finally {
      setSending(false);
    }
  }

  function clearHistory() {
    if (!confirm("清空当前会话？\n（同时通知服务器删除内存里的对话历史）")) return;
    const oldSid = sessionId.current;
    sessionId.current = "";
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(HISTORY_KEY);
    } catch {}
    setMessages([]);
    // 同步通知服务器清除内存里的 session 历史（隐私政策第 7 条）
    if (oldSid) {
      fetch("/api/chat/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: oldSid }),
        keepalive: true,
      }).catch(() => {});
    }
  }

  return (
    <>
      {/* 浮动按钮：Q 版索隆 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="AI 助手"
        title="AI 助手"
        style={{
          position: "fixed",
          right: "20px",
          bottom: "20px",
          zIndex: 9998,
          width: "64px",
          height: "64px",
          borderRadius: "50%",
          background: open
            ? "linear-gradient(135deg, #111827, #1f2937)"
            : "linear-gradient(135deg, #2d8a4e, #1e6b39)",
          color: "#fff",
          border: "3px solid #fff",
          cursor: "pointer",
          boxShadow: "0 6px 20px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.1)",
          display: "grid",
          placeItems: "center",
          transition: "transform 0.15s ease, box-shadow 0.15s ease, background 0.2s",
          padding: 0,
          overflow: "hidden",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px) scale(1.05)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0) scale(1)"; }}
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <ZoroChibiIcon size={56} />
        )}
        {unread && !open && (
          <span style={{
            position: "absolute", top: "4px", right: "4px",
            width: "12px", height: "12px", borderRadius: "50%",
            background: "#ef4444", border: "2px solid #fff",
          }} />
        )}
      </button>

      {/* 聊天面板 */}
      {open && (
        <div
          role="dialog"
          aria-label="AI 助手对话框"
          style={{
            position: "fixed",
            right: "20px",
            bottom: "88px",
            zIndex: 9998,
            width: "min(400px, calc(100vw - 40px))",
            height: "min(600px, calc(100vh - 120px))",
            background: "var(--bg, #fff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "16px",
            boxShadow: "0 20px 50px rgba(0,0,0,0.18), 0 4px 10px rgba(0,0,0,0.06)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            color: "var(--text, #111827)",
          }}
        >
          {/* 顶栏 */}
          <header style={{
            padding: "12px 14px",
            borderBottom: "1px solid var(--border-soft, #f0f1f3)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "var(--bg-soft, #f7f8fa)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{
                width: "32px", height: "32px", borderRadius: "50%",
                background: "linear-gradient(135deg, #2d8a4e, #1e6b39)",
                display: "grid", placeItems: "center",
                border: "2px solid #fff",
                overflow: "hidden",
                flexShrink: 0,
              }}>
                <ZoroChibiIcon size={26} />
              </div>
              <div>
                <div style={{ fontSize: "13.5px", fontWeight: 600 }}>索隆 · AI 助手</div>
                <div style={{ fontSize: "11px", color: "var(--text-tertiary, #9ca3af)" }}>{currentModel} · 联网搜索可选</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
              {models.length > 1 && (
                <select
                  value={currentModel}
                  onChange={(e) => {
                    setCurrentModel(e.target.value);
                    try { localStorage.setItem(MODEL_KEY, e.target.value); } catch {}
                  }}
                  title="切换模型"
                  style={{
                    fontSize: "11.5px", padding: "4px 6px",
                    border: "1px solid var(--border, #e5e7eb)",
                    borderRadius: "6px", background: "var(--bg, #fff)",
                    color: "var(--text, #111827)", cursor: "pointer", maxWidth: "120px",
                    fontFamily: "inherit", outline: "none",
                  }}>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
              <button onClick={clearHistory} title="清空"
                style={{
                  width: "28px", height: "28px", border: "none", background: "transparent",
                  borderRadius: "6px", cursor: "pointer", color: "var(--text-secondary, #6b7280)",
                  display: "grid", placeItems: "center",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.06)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            </div>
          </header>

          {/* 消息区 */}
          <div ref={scrollRef} style={{
            flex: 1, overflowY: "auto", padding: "16px 14px",
            display: "flex", flexDirection: "column", gap: "14px",
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--text-tertiary, #9ca3af)", fontSize: "13px", paddingTop: "20px" }}>
                <div style={{ fontSize: "28px", marginBottom: "8px" }}>👋</div>
                <div>嗨，我是 ZoroTreeking 的 AI 助手</div>
                <div style={{ marginTop: "4px", fontSize: "12px" }}>问我点什么吧</div>
                <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {SUGGESTED.map((s, i) => (
                    <button key={i} onClick={() => send(s)} disabled={sending}
                      style={{
                        padding: "8px 12px", border: "1px solid var(--border, #e5e7eb)",
                        background: "var(--bg, #fff)", color: "var(--text, #111827)",
                        borderRadius: "10px", fontSize: "12.5px", cursor: "pointer",
                        textAlign: "left", fontFamily: "inherit",
                      }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <Bubble key={i} msg={m} />
            ))}
          </div>

          {/* 输入区 */}
          <div style={{
            borderTop: "1px solid var(--border-soft, #f0f1f3)",
            padding: "10px 12px 12px",
            background: "var(--bg, #fff)",
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: "8px",
              marginBottom: "8px", fontSize: "12px",
            }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer", color: webSearch ? "#2563eb" : "var(--text-secondary, #6b7280)" }}>
                <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)}
                  style={{ accentColor: "#2563eb" }} />
                🌐 联网搜索
              </label>
              <span style={{ marginLeft: "auto", color: "var(--text-tertiary, #9ca3af)" }}>
                {sending ? "回复中…" : ""}
              </span>
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); send(input); }}
              style={{ display: "flex", gap: "6px" }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
                }}
                placeholder="想问点啥？Enter 发送，Shift+Enter 换行"
                rows={1}
                disabled={sending}
                style={{
                  flex: 1, resize: "none", padding: "8px 10px",
                  border: "1px solid var(--border, #e5e7eb)", borderRadius: "8px",
                  fontSize: "13.5px", fontFamily: "inherit",
                  background: "var(--bg, #fff)", color: "var(--text, #111827)",
                  outline: "none", maxHeight: "120px", lineHeight: 1.5,
                }}
              />
              <button type="submit" disabled={sending || !input.trim()}
                style={{
                  width: "38px", height: "38px", borderRadius: "8px",
                  background: sending || !input.trim() ? "#d1d5db" : "#111827",
                  color: "#fff", border: "none", cursor: sending || !input.trim() ? "not-allowed" : "pointer",
                  display: "grid", placeItems: "center", flexShrink: 0,
                }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 11l18-8-8 18-2-7-8-3z" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Bubble({ msg }: { msg: Message }) {
  const [showReasoning, setShowReasoning] = useState(false);
  if (msg.role === "user") {
    return (
      <div style={{ alignSelf: "flex-end", maxWidth: "85%" }}>
        <div style={{
          background: "var(--bg-soft, #f7f8fa)", color: "var(--text, #111827)",
          padding: "8px 12px", borderRadius: "14px",
          fontSize: "13.5px", lineHeight: 1.55, whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>{msg.text}</div>
      </div>
    );
  }
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "92%" }}>
      {msg.intent && msg.intent.intent && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)", color: "#1d4ed8", borderRadius: "10px", fontSize: "11px", fontWeight: 500, marginBottom: "6px" }}>
          {msg.intent.intent_emoji} {msg.intent.intent_label}
        </div>
      )}
      {msg.reasoning && (
        <details open={showReasoning} onToggle={(e) => setShowReasoning((e.target as HTMLDetailsElement).open)}
          style={{ marginBottom: "6px", fontSize: "12px", color: "var(--text-tertiary, #9ca3af)", borderLeft: "2px solid var(--border, #e5e7eb)", paddingLeft: "8px" }}>
          <summary style={{ cursor: "pointer", userSelect: "none", color: "var(--text-secondary, #6b7280)" }}>
            💡 思考过程
          </summary>
          <div style={{ whiteSpace: "pre-wrap", marginTop: "4px", lineHeight: 1.5 }}>{msg.reasoning}</div>
        </details>
      )}
      {msg.text && (
        <div
          style={{
            fontSize: "13.5px", lineHeight: 1.65,
            color: msg.error ? "#dc2626" : "var(--text, #111827)",
            wordBreak: "break-word",
          }}
          dangerouslySetInnerHTML={{ __html: renderMd(msg.text) }}
        />
      )}
      {!msg.text && !msg.error && (
        <div style={{ fontSize: "13px", color: "var(--text-tertiary, #9ca3af)" }}>
          <span className="dot-pulse" style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "currentColor", animation: "pulse 1.4s ease-in-out infinite" }} />
        </div>
      )}
      {msg.sources && msg.sources.length > 0 && (
        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ fontSize: "11px", color: "var(--text-tertiary, #9ca3af)" }}>参考来源 · {msg.sources.length}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {msg.sources.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: "5px",
                  padding: "4px 9px", border: "1px solid var(--border, #e5e7eb)",
                  borderRadius: "8px", fontSize: "11.5px", color: "var(--text-secondary, #6b7280)",
                  textDecoration: "none", maxWidth: "240px",
                }}>
                <span style={{
                  display: "inline-grid", placeItems: "center",
                  width: "16px", height: "16px", borderRadius: "50%",
                  background: "var(--text, #111827)", color: "#fff",
                  fontSize: "10px", fontWeight: 600,
                }}>{i + 1}</span>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "180px" }}>
                  {s.title || s.site || s.url}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
      <style>{`
        @keyframes pulse {
          0%, 60%, 100% { transform: scale(1); opacity: 0.5; }
          30% { transform: scale(1.5); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/**
 * Q 版索隆 SVG 图标。
 * 抓住几个识别度最高的特征：
 *   - 绿色立体短发（带几缕翘起的头发）
 *   - 左眼竖向疤痕 + 闭眼
 *   - 右眼睁开（黑色圆点）
 *   - 左耳三只金色耳环
 *   - 下巴右侧伸出一把刀的握柄（三刀流暗示）
 */
function ZoroChibiIcon({ size = 56 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      {/* 头颅（脸） */}
      <ellipse cx="32" cy="36" rx="19" ry="20" fill="#fce0bd" stroke="#3a2010" strokeWidth="1.2" />

      {/* 头发：绿色，带尖尖的几缕 */}
      <g fill="#39a35e" stroke="#1f6b39" strokeWidth="1.2" strokeLinejoin="round">
        {/* 主体头发壳 */}
        <path d="M 12,28 Q 12,18 18,14 Q 23,9 28,12 Q 32,7 36,12 Q 41,9 46,14 Q 52,18 52,28 Q 50,22 44,20 Q 38,18 32,20 Q 26,18 20,20 Q 14,22 12,28 Z" />
        {/* 几缕翘起的头发尖 */}
        <path d="M 20,17 L 17,8 L 23,15 Z" />
        <path d="M 28,13 L 27,5 L 32,12 Z" />
        <path d="M 36,13 L 37,5 L 32,12 Z" />
        <path d="M 44,17 L 47,8 L 41,15 Z" />
      </g>

      {/* 左眉 */}
      <path d="M 17,28 Q 21,26 24,29" stroke="#3a2010" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      {/* 右眉 */}
      <path d="M 40,29 Q 43,26 47,28" stroke="#3a2010" strokeWidth="1.8" fill="none" strokeLinecap="round" />

      {/* 左眼疤痕（竖直从眉到颊） */}
      <line x1="21" y1="25" x2="21" y2="42" stroke="#a55a32" strokeWidth="2" strokeLinecap="round" />

      {/* 左眼（疤痕侧，闭眼线） */}
      <path d="M 17,34 Q 21,36 25,34" stroke="#3a2010" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      {/* 右眼（睁开，黑色圆点） */}
      <circle cx="41" cy="34" r="2.8" fill="#1a1a1a" />
      <circle cx="42" cy="33" r="0.8" fill="#fff" />

      {/* 嘴巴：一点小坏笑 */}
      <path d="M 27,46 Q 32,48 37,46" stroke="#3a2010" strokeWidth="2" fill="none" strokeLinecap="round" />

      {/* 左耳三只金耳环 */}
      <g fill="#ffcf3a" stroke="#8a6500" strokeWidth="0.6">
        <circle cx="11" cy="36" r="1.8" />
        <circle cx="10" cy="40" r="1.8" />
        <circle cx="11" cy="44" r="1.8" />
      </g>

      {/* 右下角刀柄（三刀流暗示：菱形护手 + 缠绳柄） */}
      <g>
        <rect x="48" y="50" width="3.5" height="12" fill="#1a1a1a" transform="rotate(-30 49.75 56)" />
        <rect x="46" y="48" width="8" height="3" fill="#666" rx="0.5" transform="rotate(-30 50 49.5)" />
        <circle cx="51" cy="46" r="1.5" fill="#c9272d" />
      </g>
    </svg>
  );
}
