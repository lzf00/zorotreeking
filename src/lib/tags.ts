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
export async function getAllArticles(lang: Lang): Promise<ArticleRef[]> {
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

/** 用于 URL 的稳定 slug：保留中英文与数字，空白替换成 - */
export function tagToSlug(tag: string): string {
  return encodeURIComponent(tag.trim().replace(/\s+/g, "-"));
}
