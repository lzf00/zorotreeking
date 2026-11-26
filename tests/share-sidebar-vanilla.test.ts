/**
 * 分享栏从 React 岛改成 Astro + 原生 script（第 224 轮）。
 *
 * 它不是个慢组件，问题在它是文章页**唯一一个 `client:idle` 的岛**：
 * Astro 会为了它在 idle 时把整包 React（202 KB raw / 62 KB gz）拉下来，
 * 于是 388 个日报页 + 126 个复盘页 + 英文镜像，加载完还得再下 62 KB，
 * 只为了四个按钮。其余岛（星标、点赞）本来就是 `client:visible`，可以等读者滚到再加载。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const exists = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8").then(() => true, () => false);

const ARTICLE_PAGES = ["src/pages/ai/[slug].astro", "src/pages/en/ai/[slug].astro", "src/pages/invest/[slug].astro", "src/pages/en/invest/[slug].astro"];

test("分享栏不再是 React 组件", async () => {
  assert.equal(await exists("src/components/ShareSidebar.tsx"), false, "旧的 tsx 要删掉，别留两份实现");
  const astro = await read("src/components/ShareSidebar.astro");
  assert.match(astro, /<script>/, "行为要放在原生 script 里");
  assert.match(astro, /\.share-rail/, "样式要随组件走");
  assert.match(astro, /data-share="copy"/, "复制按钮");
  assert.match(astro, /data-share="wechat"/, "二维码按钮");
  assert.match(astro, /role="dialog"/, "二维码弹层要保住对话框语义");
});

test("文章页不再有 client:idle / client:load 的岛（否则 React 又会被提前拉下来）", async () => {
  for (const rel of ARTICLE_PAGES) {
    const src = await read(rel);
    assert.doesNotMatch(src, /client:idle/, `${rel} 出现 client:idle 会让整包 React 在 idle 时加载`);
    assert.doesNotMatch(src, /client:load/, `${rel} 出现 client:load 会让整包 React 阻塞加载`);
    assert.match(src, /<ShareSidebar[^>]*\/>/, `${rel} 要用 .astro 版分享栏`);
    assert.match(src, /from "@\/components\/ShareSidebar\.astro"/, `${rel} 要带 .astro 后缀导入`);
  }
});

test("英文页仍按语言传 lang（i18n 断言不能被这次改动带歪）", async () => {
  assert.match(await read("src/pages/en/ai/[slug].astro"), /<ShareSidebar lang="en"/);
  assert.match(await read("src/pages/en/invest/[slug].astro"), /<ShareSidebar lang="en"/);
});
