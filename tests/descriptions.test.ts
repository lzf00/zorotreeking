import assert from "node:assert/strict";
import test from "node:test";

import {
  clip,
  digestDescription,
  plainHeading,
  sectionDescription,
  tagDescription,
  tagIndexDescription,
  weeklyDescription,
} from "../src/lib/descriptions.ts";

const d = (iso: string) => new Date(iso);

const posts = [
  { title: "Hugging Face 每日论文：多模态基准", date: d("2026-11-10T00:00:00Z") },
  { title: "旧一点的一篇", date: d("2026-09-01T00:00:00Z") },
  { title: "最旧的一篇", date: d("2026-01-02T00:00:00Z") },
];

test("clip 折叠空白并按字符截断", () => {
  assert.equal(clip("  多  个   空格  ", 40), "多 个 空格");
  assert.equal(clip("一二三四五六", 4), "一二三…");
  assert.equal(clip("短", 10), "短");
});

test("标签页描述带篇数和最新一篇（不只是模板套话）", () => {
  const zh = tagDescription("arxiv", posts, "zh");
  assert.match(zh, /共 3 篇文章/);
  assert.match(zh, /多模态基准/);
  assert.match(zh, /2026 年 11 月/);
  assert.ok(zh.length > 20, "中文描述要去掉偏短告警");
});

test("标签页最新一篇按日期取，不按数组顺序", () => {
  const shuffled = [posts[2], posts[0], posts[1]];
  assert.match(tagDescription("x", shuffled, "zh"), /多模态基准/);
});

test("单篇标签用单数说法，空标签不编造内容", () => {
  assert.match(tagDescription("sample", [posts[0]], "zh"), /只有 1 篇文章/);
  assert.match(tagDescription("empty", [], "zh"), /暂无文章/);
  assert.match(tagDescription("sample", [posts[0]], "en"), /One post tagged/);
});

test("英文标签页描述可读且不重复中文标点", () => {
  const en = tagDescription("arxiv", posts, "en");
  assert.match(en, /^3 posts tagged #arxiv/);
  assert.match(en, /most recently/);
  assert.match(en, /\(November 2026\)/, "英文月份要写全，不要 11/2026");
  assert.ok(!/[《》]/.test(en), "英文描述不该出现中文书名号");
});

test("标签总览描述带数量", () => {
  assert.match(tagIndexDescription(96, "zh"), /96 个标签/);
  assert.match(tagIndexDescription(96, "en"), /96 tags/);
});

test("三个板块描述各自点题，且都够长", () => {
  const latest = posts[0];
  const ai = sectionDescription("ai", { count: 512, latest }, "zh");
  const invest = sectionDescription("invest", { count: 620, latest }, "zh");
  const photo = sectionDescription("photo", { count: 3, photos: 15, latest }, "zh");
  assert.match(ai, /512 篇/);
  assert.match(invest, /ETF/);
  assert.match(photo, /3 个相册、15 张照片/);
  for (const s of [ai, invest, photo]) assert.ok(s.length > 30, `描述偏短：${s}`);

  const en = sectionDescription("photo", { count: 3, photos: 15, latest }, "en");
  assert.match(en, /3 photo albums, 15 photos/);
});

test("没有最新一篇时描述也成立（空板块构建不炸）", () => {
  assert.ok(sectionDescription("ai", { count: 0 }, "zh").includes("0 篇"));
  assert.ok(tagDescription("t", [], "en").includes("Nothing tagged"));
});

const digestBody = `---
title: x
---

import FeedbackButtons from "@/components/FeedbackButtons";

> 免责声明

# 东方财富 7×24

## <a href="http://example.com/a" target="_blank" rel="noopener noreferrer">先进封装“小巨人”今日登陆港交所</a>

*2026/11/10 14:07:18*

## 通威拟出资14.41亿元

## 第三条标题
`;

test("plainHeading 去掉内联 HTML，保留引号", () => {
  assert.equal(plainHeading('<a href="x">标题“甲”&amp;乙</a>'), '标题“甲”&乙');
});

test("日报描述用真实条目标题，一页一种", () => {
  const zh = digestDescription(digestBody, "zh", "invest")!;
  assert.match(zh, /^3 条快讯：/);
  assert.match(zh, /先进封装/);
  assert.match(zh, /通威/);
  assert.ok(!zh.includes("多源聚合"), "不该再用套话");
  // 英文页用英文标题（含中文的会走 CJK 回退，见下一条用例）
  const enBody = `## <a href="x">First Paper Title</a>\n## Second Paper`;
  assert.match(digestDescription(enBody, "en", "ai")!, /^2 paper picks:/);
});

test("日报描述带日期，连续两天抓到同样头条也能区分开", () => {
  const d1 = digestDescription(digestBody, "zh", "invest", new Date("2026-11-10T00:00:00Z"))!;
  const d2 = digestDescription(digestBody, "zh", "invest", new Date("2026-11-11T00:00:00Z"))!;
  assert.match(d1, /（2026-11-10）$/);
  assert.notEqual(d1, d2);
});

test("日报描述不产生「…。」双标点，也不会超长", () => {
  const long = `## ${"很长的标题".repeat(20)}\n## 第二`;
  const zh = digestDescription(long, "zh", "invest")!;
  assert.ok(!zh.includes("…。"));
  assert.ok(zh.length < 90, `太长：${zh.length}`);
});

test("正文没有条目标题时返回 undefined（调用方回退 frontmatter）", () => {
  assert.equal(digestDescription("---\ntitle: x\n---\n\n只有段落", "zh", "invest"), undefined);
});

test("英文描述里混进中文时返回 undefined，让调用方回退", () => {
  const mixed = `## <a href="x">U.S. Silver Fell; 港股 Opening</a>\n## 第二条`;
  assert.equal(digestDescription(mixed, "en", "invest"), undefined);
  const clean = `## US Silver Fell\n## HK Opening`;
  assert.match(digestDescription(clean, "en", "invest")!, /^2 news briefs: US Silver Fell/);
});

const weeklyBody = `## AI 学习

- [AI 每日精选 · 2026-11-01](/ai/digest-2026-11-01/) · 2026-11-01
- [AI 每日精选 · 2026-10-31](/ai/digest-2026-10-31/) · 2026-10-31

## 投资

- [投资资讯日报 · 2026-11-01](/invest/digest-2026-11-01/) · 2026-11-01
`;

test("周报描述带各栏目条目数，不再是固定套话", () => {
  const zh = weeklyDescription(weeklyBody, "zh")!;
  assert.match(zh, /本周共 3 篇/);
  assert.match(zh, /AI 学习 2/);
  assert.match(zh, /投资 1/);
  assert.match(zh, /AI 每日精选/);
  assert.ok(!zh.includes("站长本周观察"));
});

test("周报英文描述用英文栏目名，含中文则回退", () => {
  const enBody = `## AI Learning\n\n- [Daily AI Picks · 2026-11-01](/x/) · 2026-11-01\n`;
  assert.match(weeklyDescription(enBody, "en")!, /^1 posts this week/);
  assert.equal(weeklyDescription(weeklyBody, "en"), undefined, "中文栏目名会让英文描述混排");
});

test("周报正文没有任何条目时返回 undefined", () => {
  assert.equal(weeklyDescription("## 空\n\n没有列表", "zh"), undefined);
});
