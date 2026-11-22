/**
 * 给英文正文里的中文片段标上 `lang="zh-CN"`（第 169 轮）。
 *
 * 为什么：英文页的日报会引用中文报道原文（"股价创三个月新高"）。屏幕阅读器默认用
 * `<html lang>` 指定的语言朗读，中文段落会被英语语音硬读成乱码；WCAG 3.1.2
 * （Language of Parts）要求的正是给这类片段单独标语言。
 *
 * 边界：
 *   - 只处理 `.en.mdx`（中文内容整篇都是中文，包一层只会让 HTML 白白变大）；
 *   - 不碰 `code` / `pre` / `script` / `style`：代码里的中文字符串是数据，不是朗读对象；
 *   - 祖先已经有非英文 `lang` 时跳过（避免嵌套）；
 *   - 片段太短（单个汉字）不包：`中文` 这种语言切换器的标签本身就是给中文读者看的，
 *     包起来会让读屏在 "Chinese" 和 "中文" 之间跳一次。
 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
// 汉字 + 中文标点（，。、；：！？「」『』（）《》—…），标点跟着汉字一起被朗读才自然
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3001-\u3003\u3008-\u3011\u3014-\u301f\uff01\uff08\uff09\uff0c\uff0e\uff1a\uff1b\uff1f\u2014\u2026]+/g;
const SKIP_TAGS = new Set(["code", "pre", "script", "style", "kbd", "samp"]);
const MIN_RUN = 2;

export function isEnglishSource(file) {
  const path = String(file?.path ?? file?.history?.[0] ?? "");
  return path.endsWith(".en.mdx") || path.endsWith(".en.md");
}

/** 把一段文本按中文片段切开，返回 hast 子节点数组（不修改入参） */
export function splitCjk(text) {
  const nodes = [];
  let last = 0;
  for (const match of text.matchAll(CJK_RUN)) {
    const start = match.index ?? 0;
    const run = match[0];
    // 孤立的全角标点（"…"）不单独包：只有和汉字连在一起才有朗读意义
    if (!CJK.test(run) || run.replace(/[\s\u3001-\u303f\uff00-\uffef\u2014\u2026]/g, "").length < MIN_RUN) continue;
    if (start > last) nodes.push({ type: "text", value: text.slice(last, start) });
    nodes.push({
      type: "element",
      tagName: "span",
      properties: { lang: "zh-CN" },
      children: [{ type: "text", value: run }],
    });
    last = start + run.length;
  }
  if (nodes.length === 0) return null;
  if (last < text.length) nodes.push({ type: "text", value: text.slice(last) });
  return nodes;
}

/** 收集需要处理的文本节点（跳过代码块与已标注区域） */
export function findTextNodes(tree) {
  const found = [];
  const walk = (node, insideSkipped, insideLang) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "element") {
      const tag = String(node.tagName ?? "");
      const lang = node.properties?.lang;
      const nextSkipped = insideSkipped || SKIP_TAGS.has(tag);
      const nextLang = insideLang || (typeof lang === "string" && !lang.toLowerCase().startsWith("en"));
      for (const child of node.children ?? []) walk(child, nextSkipped, nextLang);
      return;
    }
    if (node.type === "root") {
      for (const child of node.children ?? []) walk(child, insideSkipped, insideLang);
      return;
    }
    if (node.type === "text" && !insideSkipped && !insideLang && CJK.test(node.value ?? "")) found.push(node);
  };
  walk(tree, false, false);
  return found;
}

export default function rehypeCjkLang() {
  return (tree, file) => {
    if (!isEnglishSource(file)) return;
    for (const node of findTextNodes(tree)) {
      const replacement = splitCjk(node.value);
      if (!replacement) continue;
      // 原地替换：把 `data` 挂到父节点上，由下面的遍历统一处理
      node._cjkReplacement = replacement;
    }
    const apply = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node.children)) {
        const next = [];
        for (const child of node.children) {
          if (child?._cjkReplacement) {
            next.push(...child._cjkReplacement);
            continue;
          }
          apply(child);
          next.push(child);
        }
        node.children = next;
      }
    };
    apply(tree);
  };
}
