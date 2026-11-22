/**
 * 衬线兜底要分平台（第 151 轮）。
 *
 * 事实（CI 实测，`node scripts/report-font-env.mjs --json`）：
 *   runner 上只有 DejaVu Serif，没有 Times / Georgia / Liberation Serif。
 *
 * 老结构把 DejaVu Serif 挂在 `Instrument Serif Fallback` 的 local() 链尾，
 * 而那组的 size-adjust 是按 **Times** 标定的 84.3%；DejaVu Serif 需要 **65.1%**。
 * 差 29% ＝ 兜底期标题被排宽 29% → 换行数变化 → 字体到货时整块高度跳。
 *
 * 一个 @font-face 只能有一组度量参数，所以拆成两条 family：
 * `local()` 全部失败的 face 会被浏览器跳过 → macOS 命中 Times 那条、CI 命中 DejaVu 那条。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("DejaVu Serif 有自己的一条兜底，数字来自 CI 实测", async () => {
  const css = await read("src/styles/fonts.css");
  const start = css.indexOf('font-family: "DejaVu Serif Fallback"');
  assert.ok(start > 0, "没有 DejaVu Serif Fallback 兜底");
  const block = css.slice(start, start + 700);
  assert.match(block, /src: local\("DejaVu Serif"\)/);
  assert.match(block, /size-adjust: 65\.1%/, "65.1% 是 CI 实测值，不是估的");
  const ascent = Number(/ascent-override: ([\d.]+)%/.exec(block)?.[1]);
  const descent = Number(/descent-override: ([\d.]+)%/.exec(block)?.[1]);
  assert.ok(Math.abs(ascent - 152.1) < 0.5 && Math.abs(descent - 47.6) < 0.5, "行盒 override 要按实测抄");
  assert.match(block, /unicode-range:/, "只接管拉丁子集，别把 CJK 也缩放");
});

test("Times 标定的那一组不再冒充 DejaVu（这是原来的 bug）", async () => {
  const css = await read("src/styles/fonts.css");
  const timesFace = css.slice(css.indexOf('font-family: "Instrument Serif Fallback"'), css.indexOf('font-family: "Instrument Serif Fallback"') + 500);
  assert.match(timesFace, /size-adjust: 84\.3%/);
  assert.ok(
    !/local\("DejaVu Serif"\)/.test(timesFace),
    "DejaVu Serif 不能挂在 84.3% 的组里：宽度差 29%，越挂越歪",
  );
});

test("serif 栈按「网页字体 → Times 组 → DejaVu 组 → 系统」排序", async () => {
  const config = await read("tailwind.config.mjs");
  const stack = /serif: \[([\s\S]*?)\]/.exec(config)?.[1] ?? "";
  const order = ['"Instrument Serif"', '"Instrument Serif Fallback"', '"DejaVu Serif Fallback"'];
  const positions = order.map((token) => stack.indexOf(token));
  assert.ok(positions.every((pos) => pos >= 0), "栈里缺项目");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "顺序必须是 Times 组在前、DejaVu 组在后");
});
