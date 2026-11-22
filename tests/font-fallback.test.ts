import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const FONTS_CSS = new URL("../src/styles/fonts.css", import.meta.url);
const GLOBAL_CSS = new URL("../src/styles/global.css", import.meta.url);
const TAILWIND = new URL("../tailwind.config.mjs", import.meta.url);
const CHECK = new URL("../scripts/check-font-fallback.mjs", import.meta.url);
const CALIBRATE = new URL("../scripts/calibrate-fallback-metrics.mjs", import.meta.url);
const PKG = new URL("../package.json", import.meta.url);

test("声明了 metric-matched fallback，并且 size-adjust 是标定出来的具体值", async () => {
  const css = await readFile(FONTS_CSS, "utf8");
  assert.match(css, /font-family: "Inter Fallback"/);
  assert.match(css, /font-family: "Instrument Serif Fallback"/);
  assert.match(css, /size-adjust: 107\.1%/, "Inter 的 size-adjust 来自 calibrate 脚本");
  assert.match(css, /size-adjust: 84\.3%/, "Instrument Serif 的 size-adjust 来自 calibrate 脚本");
  // 只对宽度不够：行盒高度（ascent+descent）也要对齐，否则大标题换字体时整块跳
  assert.match(css, /ascent-override: 90\.6%/, "Inter 兜底要覆盖 ascent");
  assert.match(css, /descent-override: 22\.4%/, "Inter 兜底要覆盖 descent");
  assert.match(css, /font-weight: 550 900/, "粗体要单独一面，否则合成粗体窄 3.8%");
  // 正文粗体是 weight 600（typography 插件的 strong），不是 700：按 700 标定会在
  // 真元素上多折一行（第 75 轮线上 CLS 0.053 的 BLOCKQUOTE STRONG 80→50 就是它）。
  assert.match(css, /size-adjust: 101\.8%/, "粗体兜底按 600 标定，别退回 102.3%");
  assert.match(css, /ascent-override: 95\.3%/, "粗体兜底行盒要跟着 size-adjust 一起改");
  assert.match(css, /font-style: italic/, "斜体要单独标定：Inter 没有斜体文件，浏览器是合成倾斜");
  assert.match(css, /size-adjust: 102\.6%/, "斜体粗体兜底另有一档");
  // 兜底只接管与网页字体相同的字符集，否则 size-adjust 连 CJK 一起缩放
  const fallbackFaces = css.match(/font-family: "(?:Inter|Instrument Serif) Fallback";[\s\S]*?\n\}/g) ?? [];
  assert.ok(fallbackFaces.length >= 7, `兜底 face 应该有 7 个，实际 ${fallbackFaces.length}`);
  for (const face of fallbackFaces) assert.match(face, /unicode-range: U\+0000-00FF/, "每个兜底 face 都要限定字符集");
  assert.match(css, /font-weight: 500 549/, "font-medium 要单独一面");
  assert.match(css, /ascent-override: 117\.4%/, "衬线兜底要覆盖 ascent");
  assert.match(css, /descent-override: 36\.8%/, "衬线兜底要覆盖 descent");
});

test("字体栈里兜底紧跟在网页字体后面（否则永远用不到）", async () => {
  const global = await readFile(GLOBAL_CSS, "utf8");
  const tailwind = await readFile(TAILWIND, "utf8");
  assert.match(global, /"Inter", "Inter Fallback"/);
  assert.match(global, /"Instrument Serif", "Instrument Serif Fallback"/);
  assert.match(tailwind, /'"Inter"', '"Inter Fallback"'/);
});

test("有个门禁在浏览器里验证兜底宽度 ≈ 网页字体宽度，且标定脚本可复现", async () => {
  const check = await readFile(CHECK, "utf8");
  assert.match(check, /TOLERANCE = 0\.02/);
  assert.match(check, /lineRatio|行盒高度/, "要校验行盒高度，而不只是宽度");
  assert.match(check, /Inter 700/, "要分字重校验（合成粗体是最容易漏的一档）");
  assert.match(check, /process\.exit\(1\)/);
  const calibrate = await readFile(CALIBRATE, "utf8");
  assert.match(calibrate, /size-adjust/);
  const pkg = JSON.parse(await readFile(PKG, "utf8")) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts.gate.includes("check:font-fallback"), "gate 要跑它");
});

test("预载衬线和正文两套字体，但只这两套（第 150 轮改了第 73 轮的结论）", async () => {
  const layout = await readFile(new URL("../src/layouts/BaseLayout.astro", import.meta.url), "utf8");
  // 第 73 轮：只预载衬线（15KB），因为那时 LCP 被拖到 1.6s，再抢 48KB 给 Inter 会更慢。
  // 第 150 轮：CI 注解实测 `/invest/market/` 的 CLS 0.223 发生在 Inter 到货（1512ms）后 147ms，
  // 整页上移 24px —— 正文不预载就必然有一次 swap，位移必然存在。
  // 而 LCP 现在稳定在 700–800ms（好线 2.5s），有几百毫秒余量，用它换 CLS 归零是划算的。
  assert.match(layout, /rel="preload" href=\{serifFontUrl\} as="font"/, "要预载衬线体");
  assert.match(layout, /rel="preload" href=\{bodyFontUrl\} as="font"/, "正文 Inter 也要预载，否则 swap 位移无法消除");
  assert.match(layout, /import serifFontUrl from "\.\.\/assets\/fonts\/instrument-serif-400-latin\.woff2\?url"/);
  assert.match(layout, /import bodyFontUrl from "\.\.\/assets\/fonts\/inter-100-900-latin\.woff2\?url"/);
  assert.match(layout, /crossorigin="anonymous"/, "字体 preload 必须带 crossorigin，否则会重复下载");
  // 大首页面上正文 Inter 仍会被图片挤到后面（/photo/ 实测 1006ms 才到）→ 提到最高优先级
  assert.match(layout, /href=\{bodyFontUrl\}[^>]*fetchpriority="high"/, "正文 preload 要 fetchpriority=high");
  // 预载越多越挤带宽：只允许这两套（等宽在首屏基本不出现，不预载）
  const preloads = layout.match(/rel="preload"[^>]*as="font"/g) ?? [];
  assert.equal(preloads.length, 2, `字体 preload 应只有 2 个，现在是 ${preloads.length}`);
  assert.ok(!/preload[^>]*jetbrains-mono/.test(layout), "等宽体不预载");
});
