/**
 * 动态生成每篇文章的 og:image（1200×630 PNG）。
 *
 * 风格（乔布斯苹果 newsroom 风极简版）：
 *   - 白底，左上角 section 主题色圆点 + ZoroTreeking
 *   - 中央大字（serif/Inter 600）文章标题，最多 4 行
 *   - 左下日期 + section name；右下 zorotreeking.online
 *
 * URL pattern: /og/{collection}/{translationKey}.png
 *   /og/ai/digest-2026-06-05.png
 *   /og/invest/digest-2026-06-05.png
 *   /og/hike/wugong-shan.png
 *
 * 字体由 scripts/setup-fonts.sh 在 prebuild 阶段下载到 .fonts/。
 */
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs";
import path from "node:path";

const FONT_DIR = path.resolve("./.fonts");
const interRegular = fs.readFileSync(path.join(FONT_DIR, "Inter-Regular.ttf"));
const interSemibold = fs.readFileSync(path.join(FONT_DIR, "Inter-Semibold.ttf"));
const notoSC = fs.readFileSync(path.join(FONT_DIR, "NotoSansSC-Regular.ttf"));

const SECTION_COLOR: Record<string, string> = {
  ai: "#1d4ed8",
  invest: "#991b1b",
  hike: "#166534",
  photo: "#6b21a8",
};
const SECTION_LABEL: Record<string, string> = {
  ai: "AI 学习",
  invest: "个人投资",
  hike: "徒步",
  photo: "摄影",
};

export async function getStaticPaths() {
  const all = await Promise.all([
    getCollection("ai", (p) => !p.data.draft),
    getCollection("invest", (p) => !p.data.draft),
    getCollection("hike", (p) => !p.data.draft),
  ]);
  return all.flat().map((entry) => ({
    params: { slug: `${entry.collection}/${entry.data.translationKey}` },
    props: { entry },
  }));
}

export const GET: APIRoute = async ({ props }) => {
  const { entry } = props as { entry: any };
  const color = SECTION_COLOR[entry.collection] ?? "#1d1d1f";
  const label = SECTION_LABEL[entry.collection] ?? entry.collection;
  const dateStr = entry.data.date instanceof Date
    ? entry.data.date.toISOString().slice(0, 10)
    : String(entry.data.date).slice(0, 10);

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          width: "1200px",
          height: "630px",
          backgroundColor: "#ffffff",
          padding: "72px",
          fontFamily: "Inter, NotoSansSC",
          color: "#1d1d1f",
          justifyContent: "space-between",
        },
        children: [
          // ── 顶部：彩点 + ZoroTreeking ──
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", gap: "14px" },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      width: "12px",
                      height: "12px",
                      borderRadius: "9999px",
                      backgroundColor: color,
                    },
                  },
                },
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: "22px",
                      fontWeight: 600,
                      letterSpacing: "-0.01em",
                    },
                    children: "ZoroTreeking",
                  },
                },
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: "13px",
                      color: "#86868b",
                      marginLeft: "12px",
                      textTransform: "uppercase",
                      letterSpacing: "0.2em",
                    },
                    children: label,
                  },
                },
              ],
            },
          },
          // ── 中央：大标题 ──
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "24px",
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: entry.data.title.length > 30 ? "56px" : "72px",
                      fontWeight: 600,
                      lineHeight: 1.1,
                      letterSpacing: "-0.02em",
                      color,
                    },
                    children: entry.data.title,
                  },
                },
                entry.data.description && {
                  type: "div",
                  props: {
                    style: {
                      fontSize: "24px",
                      lineHeight: 1.4,
                      color: "#6e6e73",
                      fontWeight: 400,
                    },
                    children: entry.data.description,
                  },
                },
              ].filter(Boolean),
            },
          },
          // ── 底部：日期 + 域名 ──
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "16px",
                color: "#86868b",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
              },
              children: [
                { type: "div", props: { children: dateStr } },
                { type: "div", props: { children: "zorotreeking.online" } },
              ],
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Inter", data: interRegular, weight: 400, style: "normal" },
        { name: "Inter", data: interSemibold, weight: 600, style: "normal" },
        { name: "NotoSansSC", data: notoSC, weight: 400, style: "normal" },
      ],
    },
  );

  const png = new Resvg(svg).render().asPng();
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
