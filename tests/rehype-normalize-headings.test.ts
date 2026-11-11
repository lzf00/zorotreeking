import assert from "node:assert/strict";
import test from "node:test";

import plugin, {
  dropDuplicateLeadingTitle,
  shiftHeadings,
  DIGEST_PATH,
  RECAP_PATH,
} from "../src/lib/rehype-normalize-headings.mjs";

// 这些节点是 hast 的最小形态，够用即可——插件只关心 tagName 和 children。
const h = (level, text) => ({
  type: "element",
  tagName: `h${level}`,
  properties: { id: text },
  children: [{ type: "text", value: text }],
});
const p = (text) => ({ type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: text }] });
const root = (...children) => ({ type: "root", children });

test("shiftHeadings 把整棵标题树降一级，正文元素不动", () => {
  const tree = root(h(1, "分组"), p("正文"), h(2, "条目"), root(h(3, "小节")));
  const shifted = shiftHeadings(tree, 1);
  assert.equal(shifted, 3);
  assert.deepEqual(tree.children.slice(0, 3).map((c) => c.tagName), ["h2", "p", "h3"]);
  // 嵌套的 root（比如脚注/表格里的标题）也要跟着降
  assert.equal(tree.children[3].children[0].tagName, "h4");
});

test("shiftHeadings 最深封顶 h6", () => {
  const tree = root(h(6, "最底"));
  shiftHeadings(tree, 2);
  assert.equal(tree.children[0].tagName, "h6");
});

test("dropDuplicateLeadingTitle 只删开头那个重复标题", () => {
  const tree = root(h(1, "📊 11月10日股票日报"), h(2, "📈 大盘"), p("正文"));
  assert.equal(dropDuplicateLeadingTitle(tree, "📊 11月10日股票日报"), true);
  assert.deepEqual(tree.children.map((c) => c.tagName), ["h2", "p"]);
});

test("前面有引用块/段落时仍然找得到开头标题（复盘正文就是这样）", () => {
  const tree = root(
    { type: "element", tagName: "blockquote", properties: {}, children: [p("免责声明")] },
    h(1, "June 2 Stock Daily Report"),
    h(2, "Broad Market"),
  );
  assert.equal(dropDuplicateLeadingTitle(tree, undefined), true);
  assert.deepEqual(tree.children.map((c) => c.tagName), ["blockquote", "h2"]);
});

test("第一个标题不是 h1 时不删，避免误删正文小节", () => {
  const tree = root(p("开场"), h(2, "小节"));
  assert.equal(dropDuplicateLeadingTitle(tree, undefined), false);
  assert.deepEqual(tree.children.map((c) => c.tagName), ["p", "h2"]);
});

test("标题文字与页面标题不一致时不删", () => {
  const tree = root(h(1, "完全不同的标题"), h(2, "小节"));
  assert.equal(dropDuplicateLeadingTitle(tree, "页面标题"), false);
  assert.equal(tree.children.length, 2);
});

test("路径判定：日报降级、复盘去重、普通文章不动", () => {
  const digest = root(h(1, "分组"), h(2, "条目"));
  plugin()(digest, { path: "/repo/src/content/invest/digest-2026-11-10.zh.mdx" });
  assert.deepEqual(digest.children.map((c) => c.tagName), ["h2", "h3"]);

  const recap = root(h(1, "标题"), h(2, "小节"));
  plugin()(recap, { path: "/repo/src/content/invest/market-recap-2026-11-10.en.mdx" });
  assert.deepEqual(recap.children.map((c) => c.tagName), ["h2"]);

  const article = root(h(1, "标题"), h(2, "小节"));
  plugin()(article, { path: "/repo/src/content/hike/some-guide.zh.mdx" });
  assert.deepEqual(article.children.map((c) => c.tagName), ["h1", "h2"]);
});

test("路径正则只认内容目录里的日报/复盘文件名", () => {
  assert.equal(DIGEST_PATH.test("/x/src/content/ai/digest-2026-01-01.zh.mdx"), true);
  assert.equal(DIGEST_PATH.test("/x/src/content/ai/digest-2026-01-01.en.mdx"), true);
  assert.equal(DIGEST_PATH.test("/x/src/pages/ai/digest.astro"), false);
  assert.equal(RECAP_PATH.test("/x/src/content/invest/market-recap-2026-01-01.en.mdx"), true);
  assert.equal(RECAP_PATH.test("/x/src/content/invest/market-recap-x.zh.md"), false);
});
