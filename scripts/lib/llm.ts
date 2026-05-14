/**
 * 火山方舟 Kimi LLM 调用（用于 digest 摘要、翻译等离线任务）
 *
 * 需要环境变量 ARK_API_KEY（GitHub Actions 加进 Secrets）
 */

// 豆包（Doubao-Seed-2.0-Pro）：reasoning model，但比 Kimi 便宜得多
// 价格 ¥0.8/M 输入、¥2.0/M 输出（vs Kimi ¥12/¥12），更适合 digest 这种轻量任务
const MODEL_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const MODEL_NAME = "doubao-seed-2-0-pro-260215";
const API_KEY_ENV = "DOUBAO_API_KEY";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function chat(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
  const apiKey = process.env[API_KEY_ENV] || process.env.ARK_API_KEY;
  if (!apiKey) throw new Error(`${API_KEY_ENV} (or ARK_API_KEY) not set`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);

  try {
    const resp = await fetch(MODEL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 1500,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Kimi API ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timer);
  }
}

/** 简单包装：摘要一段长文 → 中文短摘要。空返回会重试一次。*/
export async function summarizeToChinese(
  source: string,
  options: { kind?: "paper" | "news"; lengthHint?: string } = {},
): Promise<string> {
  const kind = options.kind ?? "paper";
  const lenHint = options.lengthHint ?? "120 字左右";
  const sysPrompts = {
    paper:
      "你是 AI 领域的研究员。把英文论文摘要翻译并提炼成中文，简洁清晰，突出方法和结论，不复读原文。",
    news:
      "你是财经编辑。把这条资讯改写成中文短摘要，突出涉及的标的/事件/影响，避免营销语气。",
  };
  const messages: ChatMessage[] = [
    { role: "system", content: sysPrompts[kind] },
    { role: "user", content: `请用${lenHint}总结：\n\n${source}` },
  ];
  // Kimi 是 reasoning model，reasoning 本身就要 ~500-1000 token，加上正文输出 → 至少 2000
  let out = await chat(messages, { temperature: 0.3, maxTokens: 2500 });
  if (!out) {
    await new Promise((r) => setTimeout(r, 800));
    out = await chat(messages, { temperature: 0.4, maxTokens: 3000 });
  }
  return out;
}
