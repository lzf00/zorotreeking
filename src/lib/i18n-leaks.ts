/**
 * 英文页面里的中文残留（第 121 轮）。
 *
 * 线上核对 `/en/invest/market-recap-2026-11-13/` 时发现正文里整段是中文：
 *   > 微软正加紧修复故障、恢复各项服务。此次全球性宕机事件扰乱了众多企业与政府机构的运转…
 * 翻译链路只翻了标题和表格，**引用段落和部分链接标题还是中文**。读者点进英文页，
 * 看到一半是看不懂的字 —— 与其假装它是英文页，不如说清楚它是机翻的。
 *
 * 这里只做判定（纯函数），文案由调用方渲染。
 */

export type I18nLeaks = {
  /** 带 ≥15 个汉字的正文/列表行（不是标题） */
  prose: number;
  /** 带 ≥15 个汉字的引用行（`> …`） */
  quotes: number;
  /** 标题里就是中文（原始标题，通常保留） */
  headings: number;
  /** 是否有读者会"读不懂"的整段中文 */
  readerFacing: boolean;
};

const CJK = /[\u4e00-\u9fff]/g;

/** 一行里汉字的个数。 */
export function cjkCount(line: string): number {
  return (line.match(CJK) ?? []).length;
}

/** 扫描一份 markdown/MDX 正文，统计中文残留。阈值 15 字：低于这个数多是专名、`中文` 之类的引用。 */
export function cjkLeaks(markdown: string | null | undefined, { minChars = 15 } = {}): I18nLeaks {
  let prose = 0;
  let quotes = 0;
  let headings = 0;
  for (const raw of (markdown ?? "").split("\n")) {
    const line = raw.trim();
    if (cjkCount(line) < minChars) continue;
    if (line.startsWith("## ") || line.startsWith("# ") || line.startsWith("### ")) headings += 1;
    else if (line.startsWith(">")) quotes += 1;
    else prose += 1;
  }
  return { prose, quotes, headings, readerFacing: prose + quotes > 0 };
}

/** 给英文读者的说明；没有读者可见的中文残留就返回 null。 */
export function untranslatedNotice(leaks: I18nLeaks): string | null {
  if (!leaks.readerFacing) return null;
  const parts: string[] = [];
  if (leaks.quotes > 0) parts.push(`${leaks.quotes} quoted source excerpt${leaks.quotes === 1 ? "" : "s"}`);
  if (leaks.prose > 0) parts.push(`${leaks.prose} headline${leaks.prose === 1 ? "" : "s"}/paragraph${leaks.prose === 1 ? "" : "s"}`);
  return `This page is machine-translated. ${parts.join(" and ")} below remain in the original Chinese — the Chinese version of this page has the full text.`;
}

/**
 * 英文页整体是机翻的（第 211 轮）。
 *
 * 第 121 轮只处理了"英文页里还剩大段中文"这种情况。但**干净的**英文页同样有问题：
 * 全站 536 篇英文文章（AI 217 + 投资 319）都是脚本从中文稿翻出来的，
 * 读起来通顺，读者没有任何线索知道自己在读译文。
 *
 * 通顺的机翻比明显没翻完的更危险：后者读者知道要小心，前者会让人
 * 以为这句话的措辞是作者选的。所以英文文章页一律标注，并给出中文原文入口。
 */
export const MACHINE_TRANSLATION_NOTICE =
  "This page is machine-translated from the Chinese original. Wording may drift; the Chinese version is the authoritative one.";

/**
 * `/en/ai/foo/` → `/ai/foo/`；不是英文内容路径就返回 null。
 * 只做字符串处理，不查内容集合 —— 模板里已经有中英成对的 translationKey。
 */
export function zhCounterpartPath(pathname: string): string | null {
  if (!pathname.startsWith("/en/")) return null;
  const rest = pathname.slice("/en".length);
  if (!rest.startsWith("/")) return null;
  return rest;
}
