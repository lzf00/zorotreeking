/**
 * 生成站点默认 og:image（1200×630），给没有自己封面图的页面兜底。
 *
 * 用 Chromium 渲染而不是 sharp/SVG：SVG 里没法可靠地排版中文和 webfont，
 * 截图能直接用仓库里的自托管字体（src/assets/fonts）+ 系统中文衬线。
 *
 * 产物已提交到 public/og-default.png，平时不用跑；改设计时：
 *   node scripts/generate-og-default.mjs
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const b64 = async (p) => (await readFile(path.join(ROOT, p))).toString('base64');

const serif = await b64('src/assets/fonts/instrument-serif-400-latin.woff2');
const sans = await b64('src/assets/fonts/inter-100-900-latin.woff2');
const mono = await b64('src/assets/fonts/jetbrains-mono-100-800-latin.woff2');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'IS'; src: url(data:font/woff2;base64,${serif}) format('woff2'); font-display: block; }
@font-face { font-family: 'IN'; src: url(data:font/woff2;base64,${sans}) format('woff2'); font-display: block; }
@font-face { font-family: 'JM'; src: url(data:font/woff2;base64,${mono}) format('woff2'); font-display: block; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1200px; height: 630px; }
body {
  background: #0a0a0a;
  color: #f5f5f4;
  font-family: 'IN', -apple-system, 'PingFang SC', sans-serif;
  display: flex; flex-direction: column; justify-content: space-between;
  padding: 72px 80px;
  position: relative; overflow: hidden;
}
/* 一点极轻的暖色光晕，避免死黑 */
body::after {
  content: ''; position: absolute; right: -160px; top: -220px;
  width: 620px; height: 620px; border-radius: 50%;
  background: radial-gradient(circle, rgba(237,206,160,0.10), rgba(237,206,160,0) 68%);
}
.top { display: flex; justify-content: space-between; align-items: baseline; }
.domain { font-family: 'JM', monospace; font-size: 20px; letter-spacing: 0.18em; color: #7c7c78; text-transform: uppercase; }
.title { font-family: 'IS', Georgia, serif; font-size: 92px; line-height: 1.04; letter-spacing: -0.02em; }
.title .dot { color: #edcea0; }
.lang { font-size: 20px; font-family: 'JM', monospace; color: #7c7c78; letter-spacing: 0.1em; }
.tagline {
  margin-top: 26px; font-size: 42px; line-height: 1.5; color: #d8d6d0;
  font-family: 'Songti SC', 'STSong', 'Noto Serif SC', serif; font-weight: 400;
}
.bottom { display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid #232322; padding-top: 28px; }
.meta { font-family: 'JM', monospace; font-size: 19px; letter-spacing: 0.14em; color: #8a8a86; }
</style></head><body>
  <div class="top">
    <div class="domain">zorotreeking.online</div>
    <div class="lang">ZH / EN</div>
  </div>
  <div>
    <div class="title">ZoroTreeking<span class="dot">.</span></div>
    <div class="tagline">在代码与山林之间，留一份缓慢的笔记。</div>
  </div>
  <div class="bottom">
    <div class="meta">AI · 投资 · 摄影 · 徒步</div>
    <div class="meta">/og-default.png</div>
  </div>
</body></html>`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(ROOT, 'public/og-default.png'), type: 'png' });
await browser.close();
console.log('✓ public/og-default.png');
