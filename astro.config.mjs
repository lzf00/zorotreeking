import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import tailwind from "@astrojs/tailwind";
import react from "@astrojs/react";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";

const SITE = "https://www.zorotreeking.online";

// 静态输出。子域名 rewrite 由 functions/_middleware.ts 在 Cloudflare Pages 边缘处理，
// 不依赖 Astro 的 cloudflare adapter（adapter 仅 SSR 模式需要）。
export default defineConfig({
  site: SITE,
  output: "static",
  integrations: [
    mdx(),
    tailwind({ applyBaseStyles: false }),
    react(),
  ],
  i18n: {
    defaultLocale: "zh",
    locales: ["zh", "en"],
    routing: { prefixDefaultLocale: false },
  },
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      wrap: true,
    },
    rehypePlugins: [
      rehypeSlug,
      [rehypeAutolinkHeadings, { behavior: "wrap", properties: { className: ["heading-anchor"] } }],
    ],
  },
});
