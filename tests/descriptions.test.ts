import assert from "node:assert/strict";
import test from "node:test";

import {
  clip,
  sectionDescription,
  tagDescription,
  tagIndexDescription,
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
