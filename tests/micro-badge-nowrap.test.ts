/**
 * 微标签不许换行（第 150 轮）。
 *
 * 证据链：
 *   1. CI 注解里 `/invest/market/` 的 CLS 0.223，形态是「整页上移 24px」；
 *   2. 新加的布局对比（拦字体 vs 正常）报出 `span.ml-1.5.text-[10px] → +24px`；
 *   3. 该元素是新闻标题后面的「↗ 搜索」角标 —— 字体窄一点时它就不换行，
 *      宽一点（兜底期）就掉到下一行，把整个 `<li>` 顶高 24px。
 *
 * 这类 10px 的角标/代码/日期本来就不该断行：断了既难看又会抖动。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const FILES = [
  "src/pages/invest/market.astro",
  "src/pages/en/invest/market.astro",
  "src/pages/invest/stock/[code].astro",
  "src/pages/en/invest/stock/[code].astro",
];

test("行情页的 10px 角标都带 whitespace-nowrap", async () => {
  for (const file of FILES) {
    const source = await read(file);
    // 只看会被内容顶宽的角标（带 ml- 缩进前缀的），纯占位「—」不在其列
    const badges = source.match(/class="ml-[^"]*text-\[10px\][^"]*"/g) ?? [];
    assert.ok(badges.length > 0, `${file} 里没找到 10px 角标（页面结构变了？）`);
    const wrapping = badges.filter((cls) => !cls.includes("whitespace-nowrap"));
    assert.deepEqual(wrapping, [], `${file} 还有会换行的 10px 角标：${wrapping.join(" / ")}`);
  }
});

test("中英文两份页面都改了（别只修一半）", async () => {
  // 两份页面的角标数量本来就不一样（中文版多一个代码角标），别把「数量相等」当契约，
  // 要保证的是「那一处会在标题后换行的角标，两边都钉住了」
  for (const file of ["src/pages/invest/market.astro", "src/pages/en/invest/market.astro"]) {
    const source = await read(file);
    assert.match(
      source,
      /ml-1\.5 text-\[10px\][^"]*align-middle whitespace-nowrap/,
      `${file} 的「搜索」角标没钉住，仍可能换行`,
    );
  }
});
