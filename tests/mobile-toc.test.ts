/**
 * 小屏折叠目录（第 221 轮）。
 *
 * 侧边目录是 `hidden xl:block` —— 手机和平板上长文（日报 190 KB、24 个小节）
 * 此前完全没有"跳到某一节"的入口，只有回到顶部。手机是这类站的主要阅读端，
 * 这个缺口每天都在被踩。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

test("目录组件有两种形态：桌面侧栏 + 小屏折叠", async () => {
  const src = await read("src/components/TOC.astro");
  assert.match(src, /variant\?: "sidebar" \| "inline"/, "要能选形态");
  assert.match(src, /<details/, "小屏用原生 details，别引 JS");
  assert.match(src, /<summary/, "要有一行的可点标题");
  assert.match(src, /xl:hidden/, "小屏形态必须在大屏隐藏，否则和侧栏重复");
  assert.match(src, /variant === "sidebar" && items\.length > 0/, "侧栏只在侧栏形态渲染");
  assert.match(src, /variant === "inline" && items\.length > 1/, "只有一节时不值得给目录");
});

test("中英文详情页都把折叠目录放在标题下面（不是标题上面）", async () => {
  for (const rel of ["src/pages/ai/[slug].astro", "src/pages/en/ai/[slug].astro"]) {
    const src = await read(rel);
    const inlineAt = src.indexOf('variant="inline"');
    assert.ok(inlineAt > 0, `${rel} 要渲染折叠目录`);
    const headerEnd = src.lastIndexOf("</header>", inlineAt);
    assert.ok(headerEnd > 0, `${rel} 的折叠目录必须在 </header> 之后，否则会跑到标题上方`);
    assert.ok(src.indexOf("<article") < inlineAt, `${rel} 的折叠目录要在正文容器里`);
  }
});

test("桌面侧栏仍只渲染一次，避免两份同名导航", async () => {
  for (const rel of ["src/pages/ai/[slug].astro", "src/pages/en/ai/[slug].astro"]) {
    const src = await read(rel);
    const sidebar = src.match(/<TOC headings=\{headings\} label="[^"]+" \/>/g) ?? [];
    assert.equal(sidebar.length, 1, `${rel} 侧栏目录应恰好一个`);
  }
});
