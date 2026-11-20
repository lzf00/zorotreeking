import { createHash } from "node:crypto";

/**
 * 正文指纹：只保留"人读的文字"，抹掉链接、HTML 标签、JSX 组件、URL、空白差异。
 *
 * 为什么需要它：`check-content-dates` 靠「文件最后一次提交比 `updated` 晚」来判断
 * 作者是否忘了改日期。但很多提交只是机械修复——把失效外链去掉、补一个 JSX 自闭合斜杠、
 * 统一标点——正文一个字都没变。这类提交如果也算"内容更新"，就会逼着作者把 `updated`
 * 改成今天，等于系统性地说谎。用指纹比对可以精确区分「文字变了」和「只是格式变了」。
 */
export function proseFingerprint(text) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const stripped = body
    // 整行 JSX / 组件标签（<FeedbackButtons ... /> 之类）。注意也要覆盖**写坏的行**
    // ——历史上有一批 `</FeedbackButtons>` 少了斜杠的坏标签，行里没有 `>` 结尾，
    // 用「整行去掉」而不是「标签对去掉」才不会把残字漏进指纹。
    .replace(/^\s*<[A-Z].*$/gm, "")
    // HTML/MDX 标签，但保留标签之间的文字
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    // markdown 链接只留文字：[文字](url) → 文字；图片整个丢掉
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // 裸 URL
    .replace(/https?:\/\/\S+/g, "")
    // markdown 强调/代码符号与空白
    .replace(/[#>*_`~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(stripped).digest("hex");
}

/** 两个版本的正文是否实质相同 */
export function sameProse(a, b) {
  return proseFingerprint(a) === proseFingerprint(b);
}
