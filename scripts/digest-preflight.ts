#!/usr/bin/env node
/**
 * 日报流水线的 LLM 预检：把「摘要模型调不通」翻译成人话。
 *
 * 背景（第 78 轮）：AI 日报 2026-11-19 起静默停更 3 天。`digest-fetch` 的失败在
 * 现有 workflow 里只表现为「这一步红了」，而红的原因可能是密钥过期、模型下线改名、
 * 额度用尽或者网络超时 —— 后三者对下一次修复的方向完全不同。所以先花一次极小的调用
 * 把状态分辨清楚。
 *
 * 用法：
 *   npx tsx scripts/digest-preflight.ts
 * 退出码：0 = 通；1 = 不通（并打印归类后的原因）
 */
import { chat } from "./lib/llm.ts";

export type PreflightVerdict = { ok: boolean; kind: string; message: string };

/** 把底层异常归类成「该去改什么」。纯函数，便于单测。 */
export function classifyLlmError(error: unknown): PreflightVerdict {
  const message = error instanceof Error ? error.message : String(error);
  if (/not set/i.test(message)) {
    return { ok: false, kind: "missing-key", message: "DOUBAO_API_KEY / ARK_API_KEY 没有配置（Secret 丢了或被改名）" };
  }
  if (/\b401\b|unauthorized|invalid.*(api|token|key)/i.test(message)) {
    return { ok: false, kind: "bad-key", message: "密钥被拒绝（401）：多半是 Secret 过期/被轮换，去火山方舟控制台重新生成并更新 Secret" };
  }
  if (/\b403\b|forbidden/i.test(message)) {
    return { ok: false, kind: "no-permission", message: "密钥没有该模型的权限（403）：确认 Ark 控制台里已开通对应模型" };
  }
  if (/\b404\b|model.*(not|no).*(found|exist)|InvalidEndpointOrModel/i.test(message)) {
    return { ok: false, kind: "model-gone", message: "模型不存在（404）：scripts/lib/llm.ts 里写死的 MODEL_NAME 可能已下线/改名" };
  }
  if (/\b429\b|rate.?limit|quota|额度/i.test(message)) {
    return { ok: false, kind: "quota", message: "额度或并发用尽（429）：等额度恢复或换模型" };
  }
  if (/abort|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(message)) {
    return { ok: false, kind: "network", message: "调用超时/网络失败：先重试，持续失败再查出口网络" };
  }
  return { ok: false, kind: "unknown", message: `未归类的失败：${message.slice(0, 200)}` };
}

async function main() {
  const started = Date.now();
  try {
    const reply = await chat([{ role: "user", content: "只回复两个字：在线" }], { maxTokens: 16, timeoutMs: 20_000 });
    const ms = Date.now() - started;
    process.stdout.write(`✓ 摘要模型可用（${ms} ms，回复：${reply.slice(0, 20) || "(空)"}）\n`);
    process.exit(0);
  } catch (error) {
    const verdict = classifyLlmError(error);
    process.stdout.write(`✗ ${verdict.message}\n`);
    process.stderr.write(`::error title=日报 LLM 预检失败（${verdict.kind}）::${verdict.message}\n`);
    process.exit(1);
  }
}

// 用 main().catch 而不是顶层 await：测试要 import 这个文件（拿 classifyLlmError），
// 而顶层 await 会让它在 CJS 编译目标下直接编译失败（tsx 会按测试文件的格式决定目标）。
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
