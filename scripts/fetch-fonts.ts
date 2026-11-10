/**
 * 把 Google Fonts 的 latin 子集下载到 public/fonts/，生成 src/styles/fonts.css。
 *
 * 为什么自托管：
 *   1) fonts.googleapis.com 的 CSS 是渲染阻塞资源，从中国大陆访问经常超时/被墙，
 *      超时期间页面要么白屏要么退回系统字体；
 *   2) LighthouseCI 跑在 GitHub 的美国 runner 上，每个第三方源至少多两个 RTT，
 *      而站点本身在国内，首屏时间被放大成 FCP 2~4s。
 *
 * 只取 latin / latin-ext 子集（中文走系统字体，不需要 webfont）。
 *
 * 用法：npx tsx scripts/fetch-fonts.ts
 * 产物：src/assets/fonts/*.woff2 + src/styles/fonts.css（都进 git，避免构建期联网）
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
// 放 src/assets 而不是 public：Vite 会给文件名加内容哈希并输出到 /_astro/，
// 那里 nginx 配了 public, immutable —— 字体是二进制、内容变了哈希才变，值得长缓存。
const FONT_DIR = path.join(ROOT, "src", "assets", "fonts");
const CSS_OUT = path.join(ROOT, "src", "styles", "fonts.css");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

type Variant = { family: string; slug: string; query: string };

// Inter / JetBrains Mono 用可变字体（一次覆盖全部字重），比逐字重静态文件省 3~4 倍体积；
// 只留 latin 子集：中文走系统字体，latin-ext 只影响带重音的拉丁字符，博客里几乎用不到。
const VARIANTS: Variant[] = [
  { family: "Instrument Serif", slug: "instrument-serif", query: "Instrument+Serif:ital@0" },
  { family: "Instrument Serif", slug: "instrument-serif-italic", query: "Instrument+Serif:ital@1" },
  { family: "Inter", slug: "inter", query: "Inter:wght@100..900" },
  { family: "JetBrains Mono", slug: "jetbrains-mono", query: "JetBrains+Mono:wght@100..800" },
];

const KEEP_SUBSETS = new Set(["latin"]);

async function main() {
  await fs.mkdir(FONT_DIR, { recursive: true });
  const faces: string[] = [];

  for (const v of VARIANTS) {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${v.query}&display=swap`;
    const css = await (await fetch(cssUrl, { headers: { "user-agent": UA } })).text();
    // 每个 @font-face 前面带 /* subset */ 注释
    const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*{[^}]*})/g)];
    for (const [, subset, block] of blocks) {
      if (!KEEP_SUBSETS.has(subset)) continue;
      // 可变字体给的是 "font-weight: 100 900"，静态字体给单值
      const weight = /font-weight:\s*([\d ]+);/.exec(block)?.[1]?.trim() ?? "400";
      const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? "normal";
      const url = /url\((https:[^)]+\.woff2)\)/.exec(block)?.[1];
      const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
      if (!url) continue;
      const weightSlug = weight.replace(/\s+/g, "-");
      const file = `${v.slug}-${weightSlug}-${subset}${style === "italic" ? "-italic" : ""}.woff2`;
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      await fs.writeFile(path.join(FONT_DIR, file), buf);
      console.log(`  ↓ ${file} (${(buf.length / 1024).toFixed(1)}KB)`);
      faces.push(
        `@font-face {\n  font-family: "${v.family}";\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: swap;\n  src: url("../assets/fonts/${file}") format("woff2");\n  unicode-range: ${range};\n}`,
      );
    }
  }

  const header = `/* 由 scripts/fetch-fonts.ts 生成，勿手改。字体文件在 public/fonts/。 */\n`;
  await fs.writeFile(CSS_OUT, header + faces.join("\n") + "\n");
  const total = (await Promise.all((await fs.readdir(FONT_DIR)).map(async (f) => (await fs.stat(path.join(FONT_DIR, f))).size))).reduce((a, b) => a + b, 0);
  console.log(`\n[fonts] ${faces.length} 个 @font-face · 共 ${(total / 1024).toFixed(0)}KB · → ${path.relative(ROOT, CSS_OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
