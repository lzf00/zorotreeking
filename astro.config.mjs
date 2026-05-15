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
  // 开发期把 /api/* 代理到生产 AI Agent（备案前唯一能拿到响应的环境）
  // 若你想用本机的 ai-agent 跑，把下面 target 换成 http://127.0.0.1:8800 即可
  vite: {
    server: {
      proxy: {
        "/api/chat": {
          target: "http://110.40.142.199",
          changeOrigin: true,
          headers: { Host: "www.zorotreeking.online" },
        },
        "/api/upload": {
          target: "http://110.40.142.199",
          changeOrigin: true,
          headers: { Host: "www.zorotreeking.online" },
        },
        "/api/models": {
          target: "http://110.40.142.199",
          changeOrigin: true,
          headers: { Host: "www.zorotreeking.online" },
        },
        "/api/new_session": {
          target: "http://110.40.142.199",
          changeOrigin: true,
          headers: { Host: "www.zorotreeking.online" },
        },
        "/api/feedback": {
          target: "http://110.40.142.199",
          changeOrigin: true,
          headers: { Host: "www.zorotreeking.online" },
        },
      },
    },
  },
});
