/**
 * 英文页的界面属性里不许有中文（第 168 轮）。
 *
 * 正文泄漏是既有检查在管的另一类问题。这类是"交互控件对着读屏器说中文"：
 * 分享栏 "分享到 Twitter"、评分星 "3 星 · 还行"、点赞 "喜欢"、GPX 预览的 aria-label。
 * 英文读者用读屏器听到中文，而所有既有检查都只看正文。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { SCANNED_ATTRS, chineseAttrsIn } from "../scripts/check-i18n-leaks.mjs";

const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("扫的是界面属性，不是正文", () => {
  const html = `<p>这段中文是正文，不管</p><button aria-label="喜欢">x</button>`;
  const found = chineseAttrsIn(html);
  assert.deepEqual([...found.keys()], ['aria-label="喜欢"']);
});

test("内联 script / style 里的中文是代码，不算界面", () => {
  const html = `
    <style>[aria-label="喜欢"]{display:none}</style>
    <script>const t="分享到 Twitter";</script>
    <button aria-label="Copy link">x</button>`;
  assert.equal(chineseAttrsIn(html).size, 0, "CSS 选择器和 JS 字符串不能误报");
});

test("alt / title / placeholder 也要看", () => {
  const html = `<img alt="第 1 张，共 6 张"><a title="回到顶部"></a><input placeholder="搜索">`;
  const found = chineseAttrsIn(html);
  assert.equal(found.size, 3);
  assert.deepEqual(SCANNED_ATTRS, ["aria-label", "title", "placeholder", "alt"]);
});

test("英文页的关键控件都按语言传了 lang", async () => {
  const [share, rating, feedback, gpx] = await Promise.all([
    read("src/pages/en/ai/[slug].astro"),
    read("src/pages/en/ai/[slug].astro"),
    read("src/pages/en/photo/[slug].astro"),
    read("src/pages/en/hike/[slug].astro"),
  ]);
  assert.match(share, /<ShareSidebar lang="en"/);
  assert.match(rating, /<StarRating lang="en"/);
  assert.match(feedback, /<FeedbackButtons lang="en"/);
  assert.match(gpx, /<GpxMap lang="en"/);
});

test("相册沉浸模式不再拿可翻译的 aria-label 当选择器", async () => {
  for (const file of ["src/pages/photo/[slug].astro", "src/pages/en/photo/[slug].astro"]) {
    const page = await read(file);
    assert.match(page, /\[data-feedback="like"\]/, `${file} 应该用 data 属性`);
    assert.doesNotMatch(page, /\[aria-label="喜欢"\]/, `${file} 还在依赖中文 aria-label`);
  }
  const buttons = await read("src/components/FeedbackButtons.astro");
  assert.match(buttons, /data-feedback="like"/);
  assert.match(buttons, /data-feedback="dislike"/);
});
