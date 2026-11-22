/**
 * 英文正文里的中文片段必须标 `lang="zh-CN"`（第 169 轮）。
 *
 * 英文日报会引用中文报道原文。屏幕阅读器按 `<html lang="en">` 用英语音素读中文，
 * 结果是乱码；WCAG 3.1.2（Language of Parts）要求给这类片段单独标语言。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import rehypeCjkLang, { findTextNodes, isEnglishSource, splitCjk } from "../src/lib/rehype-cjk-lang.mjs";

const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("只给英文内容加标注：中文内容整篇都是中文，包一层只会变大", () => {
  assert.equal(isEnglishSource({ path: "src/content/ai/digest-2026-11-22.en.mdx" }), true);
  assert.equal(isEnglishSource({ path: "src/content/ai/digest-2026-11-22.zh.mdx" }), false);
  assert.equal(isEnglishSource({ path: "src/content/invest/recap.en.md" }), true);
  assert.equal(isEnglishSource({}), false);
});

test("中英混排只包中文，英文原样保留", () => {
  const nodes = splitCjk("Analysts said 股价创三个月新高 today.");
  assert.equal(nodes?.length, 3);
  assert.deepEqual(nodes?.[0], { type: "text", value: "Analysts said " });
  assert.deepEqual(nodes?.[1], {
    type: "element",
    tagName: "span",
    properties: { lang: "zh-CN" },
    children: [{ type: "text", value: "股价创三个月新高" }],
  });
  assert.deepEqual(nodes?.[2], { type: "text", value: " today." });
});

test("没有中文就返回 null（不改动节点）", () => {
  assert.equal(splitCjk("pure english, no hanzi here"), null);
});

test("代码块里的中文是数据，不是朗读对象", () => {
  const tree = {
    type: "root",
    children: [
      { type: "element", tagName: "p", children: [{ type: "text", value: "引用 中文原文 结束" }] },
      { type: "element", tagName: "code", children: [{ type: "text", value: "const x = 中文;" }] },
      { type: "element", tagName: "pre", children: [{ type: "text", value: "中文" }] },
    ],
  };
  const found = findTextNodes(tree as never);
  assert.equal(found.length, 1, "只有段落里的那个节点需要处理");
  assert.match(found[0].value, /引用/);
});

test("已经在中文 lang 里的节点不重复包（避免嵌套）", () => {
  const tree = {
    type: "root",
    children: [
      { type: "element", tagName: "span", properties: { lang: "zh-CN" }, children: [{ type: "text", value: "中文" }] },
      { type: "element", tagName: "p", children: [{ type: "text", value: "中文" }] },
    ],
  };
  assert.equal(findTextNodes(tree as never).length, 1);
});

test("插件把 span 真的插进树里（不是只算不写）", async () => {
  const tree = {
    type: "root",
    children: [{ type: "element", tagName: "p", children: [{ type: "text", value: "见 量子位 报道" }] }],
  };
  rehypeCjkLang()(tree as never, { path: "src/content/ai/x.en.mdx" });
  const span = (tree.children[0].children as unknown[]).find(
    (n: any) => n.type === "element" && n.properties?.lang === "zh-CN",
  );
  assert.ok(span, "应该出现 lang=zh-CN 的 span");
});

test("插件不碰中文内容文件", async () => {
  const tree = {
    type: "root",
    children: [{ type: "element", tagName: "p", children: [{ type: "text", value: "纯中文正文" }] }],
  };
  rehypeCjkLang()(tree as never, { path: "src/content/ai/x.zh.mdx" });
  assert.equal((tree.children[0].children as unknown[]).length, 1, "中文文件应原样保留");
});

test("插件已接进 astro.config 的内容管线", async () => {
  const config = await read("astro.config.mjs");
  assert.match(config, /import rehypeCjkLang from "\.\/src\/lib\/rehype-cjk-lang\.mjs"/);
  assert.match(config, /rehypeCjkLang,/);
});
