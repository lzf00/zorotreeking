/**
 * 搜索「没有结果」时该给什么（第 203 轮）。
 *
 * 第 181 轮的教训是「诚实不等于有用」——当时 `/now/` 老实说"这一页 137 天没更新"，
 * 然后就没有下一站了。搜索这里同一个毛病：搜不到时只显示一行「没有匹配结果」，
 * 读者既不知道是拼错了、问得太宽，还是这个站确实没写过，只能关掉页面。
 *
 * 所以空结果页给三样东西：
 *   1) 一句**为什么可能搜不到**（按键词形态判断，不是瞎猜）；
 *   2) 一个下一步方向（标签 / 归档 / 留言）；
 *   3) 全部是站内真实存在的路径（EN 侧只给 `/en/` 下确实有的页面）。
 *
 * 判定逻辑抽成纯函数放这里，组件只负责渲染 —— 这样「什么情况下说什么话」可以被单测盯住，
 * 而不是埋在一个 400 行的 React 组件里。
 */

export type SearchLang = "zh" | "en";

export type SearchStop = { href: string; label: string };

export type SearchEmptyState = {
  /** 主文案：为什么可能是空的 */
  headline: string;
  /** 可操作的建议，逐条列出 */
  tips: string[];
  /** 下一步能去哪（都是站内真实路由） */
  stops: SearchStop[];
};

/** 站内真实存在的入口（EN 侧没有 /en/explore，所以中英不同） */
const STOPS: Record<SearchLang, SearchStop[]> = {
  zh: [
    { href: "/tag/", label: "全部标签" },
    { href: "/archive/", label: "全部归档" },
    { href: "/explore/", label: "主题地图" },
    { href: "/guestbook/", label: "留言板" },
  ],
  en: [
    { href: "/en/tag/", label: "All tags" },
    { href: "/en/archive/", label: "All posts" },
    { href: "/en/guestbook/", label: "Guestbook" },
  ],
};

/** 关键词里有几个"词"：英文按空白切，中文按连续汉字算一段 */
export function termCount(query: string): number {
  const trimmed = query.trim();
  if (!trimmed) return 0;
  const latin = trimmed.match(/[A-Za-z0-9][A-Za-z0-9'’+.-]*/g)?.length ?? 0;
  const cjkBlocks = trimmed.match(/[\u3400-\u9fff]+/g)?.length ?? 0;
  return latin + cjkBlocks;
}

/** 关键词的"字面长度"（CJK 一个字符算 1，英文单词算 1） */
export function queryWeight(query: string): number {
  const trimmed = query.trim();
  const cjk = trimmed.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = trimmed.match(/[A-Za-z0-9][A-Za-z0-9'’+.-]*/g)?.length ?? 0;
  return cjk + latinWords;
}

/**
 * 纯函数：根据关键词形态决定空结果页说什么。
 *
 * 三种形态对应三种实话：
 *   - 词多（≥3）：多半是"加了太多条件"，页面标题里不会有整句；
 *   - 词长（weight ≥ 12）：像是把一整句塞进去了；
 *   - 其它：这个站大概确实没写过。
 */
export function searchEmptyState(query: string, lang: SearchLang = "zh"): SearchEmptyState {
  const stops = STOPS[lang];
  const terms = termCount(query);
  const weight = queryWeight(query);

  if (lang === "en") {
    if (terms >= 3) {
      return {
        headline: "Nothing matched — the query may be too specific.",
        tips: ["Try one or two keywords instead of a phrase", "Search keeps titles and body text, not questions"],
        stops,
      };
    }
    if (weight >= 12) {
      return {
        headline: "Nothing matched — that looks like a whole sentence.",
        tips: ["Keep the two or three words that matter most", "Titles rarely contain a full sentence"],
        stops,
      };
    }
    return {
      headline: "Nothing matched — this site probably has not covered it yet.",
      tips: ["Try a shorter or more general keyword", "Browse by tag or through the archive below"],
      stops,
    };
  }

  if (terms >= 3) {
    return {
      headline: "没有匹配 —— 大概是关键词给得太细了。",
      tips: ["先搜一两个词，再逐步加条件", "搜索命中的是标题与正文，不是整句提问"],
      stops,
    };
  }
  if (weight >= 12) {
    return {
      headline: "没有匹配 —— 这看着像一整句话。",
      tips: ["只留最要紧的两三个词再试", "页面标题里很少出现完整句子"],
      stops,
    };
  }
  return {
    headline: "没有匹配 —— 这个站大概还没写过这个主题。",
    tips: ["换一个更短、更常见的词试试", "也可以从下面的标签或归档里翻"],
    stops,
  };
}
