/**
 * 无障碍巡检的「模板反推」规则（第 193 轮）。
 *
 * 事故模式：`check-a11y.mjs` 用手写 PATHS 表选页，每新增一族页面都跟不上
 * （第 123/133/134/181/187 轮各踩一次；第 189–192 轮又新增 4 族分页页）。
 * 现在改成从构建产物反推路由模板，每个模板测首末页 —— 新模板自动进范围。
 *
 * 这里钉住四条归并规则，它们决定"抽到哪些页"，错一条就会整族页面漏测：
 *   1. 分页页归回第一页（`/archive/5/` → `/archive/`）
 *   2. 板块下的文章归并成 `/{板块}/*`（否则 1200+ 页 = 1200+ 个"模板"）
 *   3. 板块下的**结构性**二级页不归并（`/ai/digest/`、`/invest/market/`…）
 *   4. 日报/复盘正文、标签页、个股页各自归并成一类
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { routeTemplate, templateKey, isPaginationPage, pickTemplateSamples } = await import(
  "../scripts/lib/a11y-templates.mjs"
);

test("分页页归回第一页", () => {
  assert.equal(templateKey("/archive/5/"), "/archive/");
  assert.equal(templateKey("/tag/auto/3/"), "/tag/auto/");
  assert.equal(templateKey("/"), "/");
  assert.equal(isPaginationPage("/archive/5/"), true);
  assert.equal(isPaginationPage("/archive/"), false);
  assert.equal(isPaginationPage("/invest/stock/002371.SZ/"), false);
});

test("文章归并成板块模板，结构性二级页保持独立", () => {
  assert.equal(routeTemplate("/photo/baokemeng/"), "/photo/*/");
  assert.equal(routeTemplate("/hike/travel/ali-grand-loop-2026/"), "/hike/travel/*/");
  // 结构性二级页不能被归并掉，否则日报/行情/出行这几套骨架就不测了
  assert.equal(routeTemplate("/ai/digest/"), "/ai/digest/");
  assert.equal(routeTemplate("/ai/digest/3/"), "/ai/digest/");
  assert.equal(routeTemplate("/invest/market/"), "/invest/market/");
  assert.equal(routeTemplate("/invest/etf/"), "/invest/etf/");
  assert.equal(routeTemplate("/invest/stock/002371.SZ/"), "/invest/stock/*/");
});

test("日报正文、复盘正文、标签页各成一类", () => {
  assert.equal(routeTemplate("/ai/digest-2026-06-05/"), "/ai/__date__/");
  assert.equal(routeTemplate("/invest/market-recap-2026-11-10/"), "/invest/__date__/");
  assert.equal(routeTemplate("/tag/auto/"), "/tag/*/");
  assert.equal(routeTemplate("/en/tag/market-news/2/"), "/tag/*/");
});

test("每个模板取首末页（末页往往不满，是最容易出排版问题的边界）", () => {
  const picked = pickTemplateSamples(["/archive/", "/archive/2/", "/archive/5/", "/x/"]);
  assert.deepEqual(picked, ["/archive/", "/archive/5/", "/x/"]);
  // 单页模板只测自己
  assert.deepEqual(pickTemplateSamples(["/only/"]), ["/only/"]);
});

test("模板窗口：N 份切分互不重叠、并集是全集（每周轮转靠它）", async () => {
  const { templateWindow } = await import("../scripts/lib/a11y-templates.mjs");
  const items = Array.from({ length: 72 }, (_, i) => `t${i}`);
  const union = new Set();
  for (let k = 0; k < 7; k += 1) {
    const slice = templateWindow(items, { index: k, of: 7 });
    assert.ok(slice.length >= 10 && slice.length <= 11, `第 ${k} 份应有 10–11 项，实际 ${slice.length}`);
    for (const item of slice) {
      assert.equal(union.has(item), false, `${item} 被两份同时选中`);
      union.add(item);
    }
  }
  assert.equal(union.size, items.length, "7 份并集必须等于全集，否则永远有模板测不到");
  assert.throws(() => templateWindow(items, { index: 7, of: 7 }), /index/);
  assert.throws(() => templateWindow(items, { index: 0, of: 0 }), /of/);
});
