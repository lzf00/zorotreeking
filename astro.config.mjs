import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import { unified } from "@astrojs/markdown-remark";
import react from "@astrojs/react";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";

const SITE = "https://www.zorotreeking.online";

// 静态输出。子域名 rewrite 由 functions/_middleware.ts 在 Cloudflare Pages 边缘处理，
// 不依赖 Astro 的 cloudflare adapter（adapter 仅 SSR 模式需要）。
export default defineConfig({
  site: SITE,
  output: "static",
  build: {
    // 内联样式表。2026-11 实测对比（Lighthouse 各 3 次取中位数，preset=desktop）：
    //   内联  : / 0.95  /about 0.95  /ai 0.95  /explore 0.96
    //   外链  : / 0.86  /about 0.83  /ai 0.83  /explore 0.88
    // 站点在国内、Lighthouse 跑在美国 runner，外链样式表多出的一个往返（约 240ms）
    // 比 83KB CSS（gzip 14KB）的内联开销更贵，所以保持内联。
    inlineStylesheets: "always",
  },
  integrations: [mdx(), react()],
  i18n: {
    defaultLocale: "zh",
    locales: ["zh", "en"],
    routing: { prefixDefaultLocale: false },
  },
  redirects: {
    "/photography": "/photo",
    "/photography/": "/photo",
    "/en/photography": "/en/photo",
    "/en/photography/": "/en/photo",
  },
  markdown: {
    processor: unified({
      rehypePlugins: [
        rehypeSlug,
        [rehypeAutolinkHeadings, {
          behavior: "append",
          properties: {
            className: ["heading-anchor"],
            ariaHidden: "true",
            tabIndex: -1,
          },
        }],
      ],
    }),
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      wrap: true,
    },
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
