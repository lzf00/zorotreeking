import assert from "node:assert/strict";
import test from "node:test";

import { describeHeadingIssue, extractHeadings, headingIssues } from "../src/lib/heading-order";

test("顺序正确的标题没有告警", () => {
  const headings = extractHeadings("<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2><h3>E</h3>");
  assert.deepEqual(
    headings.map((h) => h.level),
    [1, 2, 3, 2, 3],
  );
  assert.deepEqual(headingIssues(headings), []);
});

test("跳级会被抓出来（h1 → h3）", () => {
  const issues = headingIssues(extractHeadings("<h1>A</h1><h3>C</h3>"));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "skip");
  assert.equal(issues[0].from, 1);
  assert.equal(issues[0].to, 3);
});

test("回退多级是合法的（h3 → h1 之后重新开始）", () => {
  assert.deepEqual(headingIssues(extractHeadings("<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2>")), []);
});

test("首个标题不是 h1 会提示", () => {
  const issues = headingIssues(extractHeadings("<h2>B</h2><h3>C</h3>"));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "first-not-h1");
  assert.equal(issues[0].to, 2);
});

test("没有标题的页面不算问题（缺 h1 由其他规则管）", () => {
  assert.deepEqual(headingIssues(extractHeadings("<p>只有正文</p>")), []);
});

test("跳过脚本/样式/代码里的假标题", () => {
  const html = `
    <h1>A</h1>
    <script>const s = "<h4>假的</h4>";</script>
    <style>/* <h5>也是假的</h5> */</style>
    <pre><h4>代码示例</h4></pre>
    <h2>B</h2>`;
  const headings = extractHeadings(html);
  assert.deepEqual(
    headings.map((h) => h.level),
    [1, 2],
  );
  assert.deepEqual(headingIssues(headings), []);
});

test("标题文本去掉内联标签与多余空白", () => {
  const [heading] = extractHeadings('<h2 class="x">  海拔 <em>曲线</em> </h2>');
  assert.equal(heading.text, "海拔 曲线");
});

test("问题描述可读", () => {
  const [issue] = headingIssues(extractHeadings("<h1>A</h1><h3>海拔曲线</h3>"));
  assert.match(describeHeadingIssue(issue), /h1 → h3 跳级：海拔曲线/);
});
