import { defineCollection, z } from "astro:content";

// 通用：所有文章共享的语言/翻译关联字段
const i18nBase = {
  lang: z.enum(["zh", "en"]),
  translationKey: z.string(),  // 中英两份共享同一个 key，用来跨语言定位
  title: z.string(),
  description: z.string().optional(),
  date: z.coerce.date(),
  updated: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
  cover: z.string().optional(),
};

const ai = defineCollection({
  type: "content",
  schema: z.object({
    ...i18nBase,
    category: z.enum(["basics", "paper", "tool", "applied", "thoughts"]).default("thoughts"),
  }),
});

const investPosts = defineCollection({
  type: "content",
  schema: z.object({
    ...i18nBase,
    period: z.string().optional(),     // e.g. "2026-05"
    portfolio: z.string().optional(),  // 引用 invest/portfolio/{period}.yaml
  }),
});

// 投资持仓快照（YAML，非 mdx）
const investPortfolio = defineCollection({
  type: "data",
  schema: z.object({
    period: z.string(),
    asOf: z.coerce.date(),
    currency: z.string().default("CNY"),
    totalValue: z.number(),
    holdings: z.array(z.object({
      symbol: z.string(),
      name: z.string(),
      market: z.enum(["A", "HK", "US", "ETF", "Crypto", "Cash", "Other"]),
      shares: z.number(),
      costAvg: z.number(),
      lastPrice: z.number(),
      marketValue: z.number(),
      weight: z.number(),
    })),
    notes: z.string().optional(),
  }),
});

const photo = defineCollection({
  type: "content",
  schema: z.object({
    ...i18nBase,
    location: z.string().optional(),
    // 可选；省略时按 translationKey 找 src/data/photo-manifest/{key}.json
    manifest: z.string().optional(),
    cameraSummary: z.string().optional(),
    // Decap 上传后写在 frontmatter 的图片清单。页面不直接读它——图片由
    // scripts/build-photo-manifests.ts 扫盘生成 manifest。这里只为容错，
    // 不管 Decap 写成单字符串、字符串数组、对象数组都收。
    photos: z.any().optional(),
  }),
});

const hike = defineCollection({
  type: "content",
  schema: z.object({
    ...i18nBase,
    location: z.string(),
    distanceKm: z.number().optional(),
    elevationGainM: z.number().optional(),
    durationHours: z.number().optional(),
    difficulty: z.enum(["easy", "moderate", "hard", "expert"]).default("moderate"),
    gpx: z.string().optional(),         // public/gpx/xxx.gpx 文件名
    photoAlbum: z.string().optional(),  // 关联的 photo album slug
  }),
});

export const collections = {
  ai,
  invest: investPosts,
  "invest-portfolio": investPortfolio,
  photo,
  hike,
};
