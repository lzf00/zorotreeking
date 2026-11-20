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
  assert.match(check, /process\.exit\(1\)/);
  const calibrate = await readFile(CALIBRATE, "utf8");
  assert.match(calibrate, /size-adjust/);
  const pkg = JSON.parse(await readFile(PKG, "utf8")) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts.gate.includes("check:font-fallback"), "gate 要跑它");
});
