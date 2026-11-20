import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SCRIPT = new URL("../scripts/check-interactions.mjs", import.meta.url);

test("四个交互场景都要在清单里（搜索/灯箱/点赞/深浅色）", async () => {
  const src = await readFile(SCRIPT, "utf8");
  for (const keyword of ["搜索弹窗（中文）", "相册灯箱（中文）", "点赞按钮", "深色模式切换"]) {
    assert.ok(src.includes(keyword), `缺场景：${keyword}`);
  }
});

test("场景断言不能只看「没报错」，必须有 DOM 状态断言", async () => {
  const src = await readFile(SCRIPT, "utf8");
  assert.match(src, /pswp--open/, "灯箱要断言 .pswp--open 出现");
  assert.match(src, /aria-pressed/, "点赞要断言 aria-pressed 变化");
  assert.match(src, /classList\.contains\("dark"\)/, "主题要断言 dark 类翻转");
  assert.match(src, /\[role="dialog"\] a\[href\]/, "搜索要断言真的出结果");
});

test("/api/* 必须 stub：静态服务器没有这些接口", async () => {
  const src = await readFile(SCRIPT, "utf8");
  assert.match(src, /page\.route\("\*\*\/api\/\*\*"/);
  assert.match(src, /\/api\/feedback/);
});

test("deploy 工作流要跑交互自检，exit 2 降级", async () => {
  const wf = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.ok(wf.includes("npm run check:interactions"));
});
