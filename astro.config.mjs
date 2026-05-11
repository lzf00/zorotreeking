import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwind from "@astrojs/tailwind";
import react from "@astrojs/react";
import cloudflare from "@astrojs/cloudflare";

// 主域名（带 protocol，sitemap / OG / RSS 需要绝对 URL）
const SITE = "https://www.zorotreeking.online";

export default defineConfig({
  site: SITE,
  output: "hybrid",
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  integrations: [
    mdx(),
    tailwind({ applyBaseStyles: false }),
    react(),
    sitemap({
      i18n: {
        defaultLocale: "zh",
        locales: { zh: "zh-CN", en: "en" },
      },
    }),
  ],
  i18n: {
    defaultLocale: "zh",
    locales: ["zh", "en"],
    routing: { prefixDefaultLocale: false },
  },
  vite: {
    ssr: {
      external: ["node:async_hooks"],
    },
  },
});
