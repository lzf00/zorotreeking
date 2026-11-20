/**
 * 多源收集 + 「源全挂了」的判定（从 scripts/digest-fetch.ts 抽出来的纯逻辑）。
 *
 * 为什么要单独成库（第 79 轮）：AI 日报 2026-11-19 起静默停更 3 天，而 workflow 一直是
 * 绿的。原因是 `collectFromSources` 里单源失败只 `console.warn` 就继续，收完是空数组时
 * `buildAIDigest` 直接 `console.log("no papers; skip.")` → return → 退出码 0 →
 * 下游「没有新文件」也退出 0。整条链上没有任何一步会红。
 *
 * 这里把两件事分开：
 *   1. 收集本身继续容错（单源失败不能拖垮整天）
 *   2. **收集完的体检**独立判断：一条都没收到，或者失败源占比过高，就叫停
 *
 * 抽成库还有一个好处：可以喂假源做单测，不用真的联网调 10 个站点。
 */

export type SourceSpec<T> = { name: string; fetch: () => Promise<T[]>; limit: number };
export type SourceDiagnostic = { name: string; ok: boolean; count: number; kept: number; detail?: string };
export type CollectResult<T> = { items: T[]; diagnostics: SourceDiagnostic[] };

/**
 * 并行拉所有源 → 单源失败记日志继续 → 按 URL 去重 → 每源截断到 limit。
 * 不抛错（源失败是常态），是否「不可接受」交给 starvationReason 判断。
 */
export async function collectFromSources<T extends { url?: string }>(
  sources: SourceSpec<T>[],
  log: (message: string) => void = () => {},
): Promise<CollectResult<T>> {
  const results = await Promise.allSettled(sources.map((source) => source.fetch()));
  const seen = new Set<string>();
  const items: T[] = [];
  const diagnostics: SourceDiagnostic[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const source = sources[i];
    if (result.status === "rejected") {
      const detail = (result.reason as Error)?.message ?? String(result.reason);
      log(`  ✗ source ${source.name} failed: ${detail}`);
      diagnostics.push({ name: source.name, ok: false, count: 0, kept: 0, detail: detail.slice(0, 200) });
      continue;
    }
    const got = result.value.slice(0, source.limit);
    log(`  ✓ source ${source.name}: ${got.length} items`);
    diagnostics.push({ name: source.name, ok: true, count: result.value.length, kept: got.length });
    for (const item of got) {
      const key = (item.url || "").trim();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      items.push(item);
    }
  }

  return { items, diagnostics };
}

/**
 * 收集结果的体检：返回「该叫停」的理由，健康则返回 null。
 *
 * 阈值取 `minimum`（默认 3）：10 个 AI 源、每家 limit 2–5，正常日子能收 15+ 条；
 * 只收到 0–2 条基本等于「全被挡了」或「上游改版了」，这时候产出的日报也没有信息量。
 */
export function starvationReason(stream: "ai" | "invest", { items, diagnostics }: CollectResult<unknown>, minimum = 3): string | null {
  if (items.length >= minimum) return null;
  const label = stream === "ai" ? "AI 日报" : "投资复盘";
  const failed = diagnostics.filter((d) => !d.ok);
  const empty = diagnostics.filter((d) => d.ok && d.count === 0);
  const parts = diagnostics.map((d) => `${d.name}=${d.ok ? `${d.count}条` : "失败"}`).join(", ");
  return [
    `${label}今天只收到 ${items.length} 条（阈值 ${minimum}），不出稿。`,
    `失败源 ${failed.length}/${diagnostics.length}、空源 ${empty.length}。逐源：${parts}`,
    failed.length === diagnostics.length
      ? "全部源都失败 —— 多半是 CI runner 的出口 IP 被站点挡了，或上游接口改版。"
      : "部分源失败，先看上面标注失败的那几个站点是否还活着。",
  ].join("\n");
}

/** 体检报告的落盘格式（workflow 失败时把这份 JSON 贴进 run 页面）。 */
export function diagnosticsReport(stream: "ai" | "invest", result: CollectResult<unknown>, minimum = 3) {
  return {
    stream,
    collected: result.items.length,
    minimum,
    verdict: starvationReason(stream, result, minimum) ? "starved" : "ok",
    sources: result.diagnostics,
  };
}

/**
 * 摘要健康度：源收到了、但**每一条摘要都失败**时，产出的是一篇占位符文章。
 *
 * 第 79 轮实测：没有 API key 跑 `digest-fetch.ts ai`，20 条全部摘要失败，脚本仍然
 * 写出 `digest-2026-11-21.zh.mdx`（内容全是「（LLM 摘要失败，请稍后手动补充）」），
 * 退出码 0。这比停更更糟：停更只是没内容，失败摘要会**发布垃圾**。
 *
 * 阈值取 30%：偶尔一条超时/被截断可以容忍，过半就是流水线坏了。
 */
export function summaryHealth(stream: "ai" | "invest", failed: number, total: number, maxFailureRatio = 0.3) {
  const label = stream === "ai" ? "AI 日报" : "投资复盘";
  if (total === 0) return { ratio: 0, fatal: false, reason: null };
  const ratio = failed / total;
  if (ratio <= maxFailureRatio) return { ratio, fatal: false, reason: null };
  return {
    ratio,
    fatal: true,
    reason: `${label} ${total} 条里有 ${failed} 条摘要失败（${Math.round(ratio * 100)}%，阈值 ${Math.round(maxFailureRatio * 100)}%），不出稿以免发布占位符。先看摘要模型是否可用（scripts/digest-preflight.ts）。`,
  };
}
