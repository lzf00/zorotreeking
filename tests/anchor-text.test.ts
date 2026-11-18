import assert from "node:assert/strict";
import test from "node:test";

import {
  anchorIssues,
  describeAnchorIssue,
  extractAnchors,
  isInternalHref,
} from "../src/lib/anchor-text";

test("提取锚点：文字去标签、折叠空白、解码实体", () => {
  const html = `<a href="/hike/">  <span>徒步</span>\n  路线  </a>
    <a href="https://www.zorotreeking.online/photo/">相册 &amp; 照片</a>`;
  const rows = extractAnchors(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, "徒步 路线");
  assert.equal(rows[0].href, "/hike/");
  assert.equal(rows[1].text, "相册 & 照片");
});

test("script / style / pre 里的伪链接不参与检查", () => {
  const html = `<script>const a = '<a href="/fake/">x</a>'</script>
    <style>/* <a href="/nope/"> */</style>
    <a href="/real/">真实</a>`;
  const rows = extractAnchors(html);
  assert.deepEqual(rows.map((r) => r.href), ["/real/"]);
});

test("空锚文本：有 aria-label 就不算缺陷", () => {
  const html = `<a href="/guestbook/" aria-label="留言板"><svg></svg></a>
    <a href="/admin/"><svg></svg></a>
    <a href="/photo/" title="相册"><img src="a.jpg" alt=""></a>`;
  const issues = anchorIssues(extractAnchors(html));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "empty");
  assert.equal(issues[0].href, "/admin/");
});

test("通用锚文本记为告警，有信息量的不报", () => {
  const html = `<a href="/a/">阅读更多</a><a href="/b/">Read More</a>
    <a href="/c/">阿里大环线回来了：一条 4500 公里的路线复盘</a>`;
  const issues = anchorIssues(extractAnchors(html));
  assert.deepEqual(issues.map((i) => [i.kind, i.text]), [
    ["generic", "阅读更多"],
    ["generic", "Read More"],
  ]);
});

test("外链不参与锚文本检查", () => {
  const html = `<a href="https://github.com/x"><svg></svg></a><a href="//cdn.example.com/a">cdn</a>`;
  assert.deepEqual(anchorIssues(extractAnchors(html)), []);
});

test("站内判定：相对路径算，协议相对与站外不算", () => {
  assert.equal(isInternalHref("/hike/"), true);
  assert.equal(isInternalHref("https://www.zorotreeking.online/hike/"), true);
  assert.equal(isInternalHref("//cdn.example.com/x"), false);
  assert.equal(isInternalHref("https://x.com/a"), false);
  assert.equal(isInternalHref("#anchor"), false);
});

test("描述文案区分两类问题", () => {
  assert.match(describeAnchorIssue({ kind: "empty", href: "/x/", text: "" }), /空锚文本.*\/x\//);
  assert.match(describeAnchorIssue({ kind: "generic", href: "/y/", text: "阅读更多" }), /通用锚文本「阅读更多」/);
});
