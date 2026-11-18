import { getCollection } from "astro:content";
import type { Lang } from "@/i18n/ui";

export type ArticleRef = {
  section: "ai" | "invest" | "photo" | "hike";
  slug: string;        // translationKey
  title: string;
  description?: string;
  date: Date;
  tags: string[];
};

const SECTIONS = ["ai", "invest", "photo", "hike"] as const;

/** 跨四个 collection 收集某语言下的全部文章（不含 draft） */
async function getAllArticles(lang: Lang): Promise<ArticleRef[]> {
  const out: ArticleRef[] = [];
  for (const section of SECTIONS) {
    const items = await getCollection(section, (p) => p.data.lang === lang && !p.data.draft);
    for (const it of items) {
      out.push({
        section,
        slug: it.data.translationKey,
        title: it.data.title,
        description: it.data.description,
        date: it.data.date,
        tags: it.data.tags ?? [],
      });
    }
  }
  return out.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/**
 * 某个板块下最近的文章（排除当前页里已有的 slug）。
 *
 * 用在「只有一两篇内容的标签页」上：这类页面正文天然很短，与其硬写文案，不如把同栏目
 * 最近的几篇列出来——对读者有用，也顺手补了内链。
 */
export async function recentInSection(
  lang: Lang,
  section: "ai" | "invest" | "photo" | "hike",
  limit = 5,
  exclude: string[] = [],
): Promise<ArticleRef[]> {
  const items = await getCollection(section, (p) => p.data.lang === lang && !p.data.draft);
  const skip = new Set(exclude);
  return items
    .map((it) => ({
      section,
      slug: it.data.translationKey,
      title: it.data.title,
      description: it.data.description,
      date: it.data.date,
      tags: it.data.tags ?? [],
    }))
    .filter((it) => !skip.has(it.slug))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, limit);
}

/** 标签 → 文章列表，按出现次数倒序的 tag 列表 */
export async function buildTagIndex(lang: Lang) {
  const articles = await getAllArticles(lang);
  const map = new Map<string, ArticleRef[]>();
  for (const a of articles) {
    for (const t of a.tags) {
      if (!t) continue;
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(a);
    }
  }
  const tags = [...map.entries()]
    .map(([tag, posts]) => ({ tag, posts, count: posts.length }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return { tags, articles };
}

// slug 与标签关系都是纯数据计算，实现放在 tag-relations.ts 里（那边不依赖 astro:content，
// 可以被 node --test 直接测），这里只做再导出，保持 `@/lib/tags` 的导入路径不变。
export { relatedTags, tagSections, tagToSlug } from "./tag-relations";
