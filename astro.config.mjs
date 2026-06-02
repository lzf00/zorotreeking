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
      // append: 不再把整个标题包成锚链，避免与"标题即外链"冲突；末尾追加一个隐形锚作 #fragment 定位
      [rehypeAutolinkHeadings, { behavior: "append", properties: { className: ["heading-anchor"], ariaHidden: "true", tabIndex: -1 } }],
    ],
  },
  // 开发期把 /api/* 代理到生产 AI Agent。
  // 备案已下来，直接用 HTTPS 域名，不用再 IP + Host header 绕路。
  // 若想用本机的 ai-agent 跑，把 target 换成 http://127.0.0.1:8800 即可。
  vite: {
    server: {
      proxy: (() => {
        const target = "https://www.zorotreeking.online";
        const common = { target, changeOrigin: true, secure: true };
        return {
          "/api/chat":        common,
          "/api/upload":      common,
          "/api/models":      common,
          "/api/new_session": common,
          "/api/feedback":    common,
          "/api/track":       common,
          // 投资页 React islands 走 /api/market/{indices,funds,sentiment,sectors,quote}
          "/api/market":      common,
          // 数据主体权利页（合规栈）走 /api/data/{me,delete}
          "/api/data":        common,
        };
      })(),
    },
  },
});
