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
