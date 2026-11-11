import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import { unified } from "@astrojs/markdown-remark";
import react from "@astrojs/react";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeNormalizeContentHeadings from "./src/lib/rehype-normalize-headings.mjs";

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
  // 只声明不带尾斜杠的形式：build.format=directory 下 /photography 和 /photography/
  // 是同一个路由，两条都写会触发 Astro 的 duplicate route 警告（未来版本会变硬错误）。
  redirects: {
    "/photography": "/photo",
    "/en/photography": "/en/photo",
  },
  markdown: {
    processor: unified({
      rehypePlugins: [
        // 日报正文整体降一级、复盘正文去掉重复标题 —— 模板已经有 h1 了，
        // 再让正文出 h1 会让 718 个页面各自有 2～10 个主标题。
        rehypeNormalizeContentHeadings,
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
