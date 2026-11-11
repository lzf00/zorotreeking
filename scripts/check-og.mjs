/**
 * 社交卡片（og:image）门禁：把 dist 里所有页面翻一遍，确认分享图真的能拿到。
 *
 * 为什么需要它：2026-11 的审计发现 42 个页面的 og:image 指向不存在的文件
 * （英文投资日报有 40 篇机器翻译稿没带 cover，落到从没生成过的
 * `/og/invest/<slug>.png`），另外还有几个页面拿 3.6MB / 1080×2400 的原图当卡片。
 * 这些页面在站内一切正常，只有分享到微信/Telegram/Slack 时才露馅，所以
 * Lighthouse 和 axe 都抓不到——只能靠这条静态检查。
 *
 * 用法：
 *   npm run build && node scripts/check-og.mjs        # 检查 dist
 *   node scripts/check-og.mjs --dist=dist --strict    # 警告也算失败
 *
 * 判定：
 *   · 缺 og:image / twitter:image                         → 错误
 *   · og:image 不是绝对 URL                               → 错误
 *   · og:image 指向的文件在 dist 里不存在                  → 错误
 *   · 声明的宽高与图片真实宽高不一致                       → 错误
 *   · 单张 > 512KB、比例不像卡片（1.2–3.4 之外）           → 警告
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const DIST = path.resolve(
  (args.find((a) => a.startsWith("--dist=")) ?? "--dist=dist").split("=")[1],
);
const STRICT = args.includes("--strict");
const SITE = "https://www.zorotreeking.online";

if (!fs.existsSync(DIST)) {
  console.error(`[og] 找不到 ${DIST}，先跑 npm run build`);
  process.exit(1);
}

/** 归一化文件名比较：macOS 上文件系统存的是 NFD，HTML 里是 NFC，直接比会假失败。 */
const nfc = (s) => s.normalize("NFC");

const dirs = [];
const assets = new Set();
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      dirs.push(full);
      walk(full);
    } else {
      assets.add(nfc("/" + path.relative(DIST, full).split(path.sep).join("/")));
    }
  }
})(DIST);

const pages = dirs.filter((d) => assets.has(nfc("/" + path.relative(DIST, d).split(path.sep).join("/") + "/index.html")));

const errors = [];
const warnings = [];
const sizeCache = new Map();

async function inspect(file) {
  if (sizeCache.has(file)) return sizeCache.get(file);
  let info = null;
  try {
    const buf = fs.readFileSync(file);
    const meta = await sharp(buf).metadata();
    info = { bytes: buf.length, width: meta.width ?? 0, height: meta.height ?? 0 };
  } catch {
    info = { bytes: 0, width: 0, height: 0 };
  }
  sizeCache.set(file, info);
  return info;
}

for (const pageDir of pages) {
  const pageUrl = "/" + path.relative(DIST, pageDir).split(path.sep).join("/") + "/";
  const html = fs.readFileSync(path.join(pageDir, "index.html"), "utf8");
  // 纯跳转页（meta refresh）和 noindex 页（后台、预览）不承载社交卡片
  if (/http-equiv="refresh"/i.test(html)) continue;
  if (/<meta name="robots" content="[^"]*noindex/i.test(html)) continue;

  const get = (prop) => {
    const m = html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`));
    return m ? m[1] : null;
  };
  const ogImage = get("og:image");
  const twitterImage = get("twitter:image");
  if (!ogImage) {
    errors.push(`${pageUrl} 没有 og:image`);
    continue;
  }
  if (!ogImage.startsWith("http")) {
    errors.push(`${pageUrl} og:image 不是绝对 URL（${ogImage}）`);
    continue;
  }
  if (twitterImage && twitterImage !== ogImage) {
    warnings.push(`${pageUrl} twitter:image 与 og:image 不一致`);
  }

  const relPath = nfc(decodeURIComponent(ogImage.replace(SITE, "")));
  const file = path.join(DIST, relPath);
  if (!assets.has(nfc(relPath))) {
    errors.push(`${pageUrl} og:image 指向不存在的文件 ${relPath}`);
    continue;
  }

  const info = await inspect(file);
  const declaredW = Number(get("og:image:width"));
  const declaredH = Number(get("og:image:height"));
  if (info.width && declaredW && info.height && declaredH && (info.width !== declaredW || info.height !== declaredH)) {
    errors.push(
      `${pageUrl} 声明 ${declaredW}×${declaredH}，实际 ${info.width}×${info.height}（${relPath}）`,
    );
  }
  if (info.bytes > 512 * 1024) {
    warnings.push(`${pageUrl} 分享图 ${(info.bytes / 1024).toFixed(0)}KB（${relPath}）`);
  }
  const ratio = info.width && info.height ? info.width / info.height : 0;
  if (ratio && (ratio < 1.2 || ratio > 3.4)) {
    warnings.push(`${pageUrl} 分享图比例 ${ratio.toFixed(2)}（${relPath}）`);
  }
}

const uniq = (list) => [...new Set(list)];
const errs = uniq(errors);
const warns = uniq(warnings);

console.log(`[og] 检查 ${pages.length} 个页面`);
for (const w of warns.slice(0, 15)) console.log(`  ⚠ ${w}`);
if (warns.length > 15) console.log(`  ⚠ …还有 ${warns.length - 15} 条`);
for (const e of errs.slice(0, 25)) console.log(`  ✗ ${e}`);
if (errs.length > 25) console.log(`  ✗ …还有 ${errs.length - 25} 条`);

const failed = errs.length > 0 || (STRICT && warns.length > 0);
console.log(
  `[og] ${errs.length} 错误 / ${warns.length} 警告${STRICT ? "（strict）" : ""} → ${failed ? "失败" : "通过"}`,
);
process.exit(failed ? 1 : 0);
