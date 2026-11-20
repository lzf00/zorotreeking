import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SCRIPT = new URL("../scripts/check-interactions.mjs", import.meta.url);

test("四个交互场景都要在清单里（搜索/灯箱/点赞/深浅色）", async () => {
  const src = await readFile(SCRIPT, "utf8");
  const names = [
    "搜索弹窗（中文）",
    "相册灯箱（中文）",
    "点赞按钮",
    "深色模式切换",
    "键盘 / 唤起搜索",
    "手机搜索（390 宽）",
    "手机灯箱（390 宽）",
    "手机灯箱关闭按钮",
    "ETF 接口失败 → 重试成功（手机视口）",
  ];
  for (const keyword of names) {
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
  // 手机场景要给触屏上下文，否则 tap/点击行为与真实手机不一致
  assert.match(src, /hasTouch: touch/, "手机场景必须带 hasTouch");
  assert.match(src, /\/api\/feedback/);
});

test("deploy 工作流要跑交互自检，exit 2 降级", async () => {
  const wf = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.ok(wf.includes("npm run check:interactions"));
});

test("相册索引页不许落到站点默认分享卡（check-og 里要有这条规则）", async () => {
  const og = await readFile(new URL("../scripts/check-og.mjs", import.meta.url), "utf8");
  assert.match(og, /const DEFAULT_CARD_PAGES = new Set\(\["\/photo\/", "\/en\/photo\/"\]\)/);
  assert.match(og, /用了站点默认分享卡/);
});

test("场景可以自定义接口桩（失败 → 重试成功的链路要能验证）", async () => {
  const src = await readFile(SCRIPT, "utf8");
  assert.match(src, /const custom = Object\.entries\(scenario\.api \?\? \{\}\)/, "要支持按场景覆盖接口");
  assert.match(src, /apiHits\.set\(prefix, call \+ 1\)/, "要能按调用次数返回不同结果");
  assert.match(src, /桩数据ETF/, "断言要用真实数据里不可能出现的哨兵值");
});

