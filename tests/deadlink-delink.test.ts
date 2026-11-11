import assert from "node:assert/strict";
import test from "node:test";

import { delink } from "../scripts/deadlink-delink";

// 周扫发现死链后，用这个函数把引用摘成纯文本。三种写法都要覆盖，
// 而且必须幂等——跑第二次不能把正文吃掉。
const URL = "http://finance.eastmoney.com/a/202610263907803637.html";

test("html anchors keep their text and lose the href", () => {
  const src = `## <a href="${URL}" target="_blank" rel="noopener noreferrer">“追光者”+1！300916，“20CM”涨停</a>`;
  const out = delink(src, URL);
  assert.equal(out.count, 1);
  assert.equal(out.text, "## “追光者”+1！300916，“20CM”涨停");
  assert.equal(out.text.includes("eastmoney"), false);
});

test("markdown links keep their label", () => {
  const src = `- [央行开展逆回购](${URL})\n- [另一篇](${URL} "标题")`;
  const out = delink(src, URL);
  assert.equal(out.count, 2);
  assert.equal(out.text, "- 央行开展逆回购\n- 另一篇");
});

test("bare urls are removed but surrounding punctuation survives", () => {
  const src = `来源：${URL}。`;
  const out = delink(src, URL);
  assert.equal(out.count, 1);
  assert.equal(out.text, "来源：。");
});

test("running twice is a no-op", () => {
  const src = `## <a href="${URL}">标题</a>`;
  const once = delink(src, URL).text;
  const twice = delink(once, URL);
  assert.equal(twice.count, 0);
  assert.equal(twice.text, once);
});

test("other links in the same file are untouched", () => {
  const other = "https://news.10jqka.com.cn/20261027/c681124809.shtml";
  const src = `[留下我](${other})\n[摘掉我](${URL})`;
  const out = delink(src, URL);
  assert.equal(out.text, `[留下我](${other})\n摘掉我`);
});
