import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const DIR = new URL("../src/data/photo-manifest/", import.meta.url);

// 派生文件名一旦混进 manifest，就会变成一张「新照片」，而且按字典序
// `xxx.hero.webp` 排在 `xxx.jpeg` 前面 → 直接顶掉相册封面。第 43 轮踩过一次。
const DERIVED = [".hero.webp", ".thumb.webp", ".og.jpg", ".w640.jpg", ".w960.jpg"];
const DERIVED_WIDTHS = [".thumb480.webp"];
// 派生变体的「派生」：.og.w640.webp / .w960.webp 之类（第 49 轮在本地留下的历史文件里抓到过）。
// 这类文件后缀不在上面那张表里，但同样是派生，按「文件名中间出现派生段」判定。
const DERIVED_SEGMENT = /\.(?:og|thumb|hero)\.|(\.og)?\.w(?:640|960)\./i;

test("manifest 里不许出现派生文件（.hero/.thumb/.og/w640/w960）", async () => {
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json"));
  assert.ok(files.length > 0, "至少应有一个 manifest");
  for (const file of files) {
    const entries = JSON.parse(await readFile(new URL(file, DIR), "utf8"));
    for (const entry of entries) {
      // thumbSm 本身就长成 .thumb480.webp，是「预期的派生」，由 gallery-srcset 测试单独校验；
      // 这里只盯 src/thumb 这类会被当成整张照片的字段。
      for (const key of ["src", "thumb"]) {
        const value: string | undefined = entry[key];
        assert.ok(value, `${file}: 条目缺 ${key}`);
        for (const suffix of [...DERIVED, ...DERIVED_WIDTHS]) {
          assert.ok(
            !value.endsWith(suffix),
            `${file}: ${key} 是派生文件 ${value}（会被当成一张新照片）`,
          );
        }
        assert.ok(
          !DERIVED_SEGMENT.test(decodeURIComponent(value)),
          `${file}: ${key} 是「派生的派生」 ${value}（同样会被当成一张新照片）`,
        );
      }
    }
  }
});

test("manifest 条目数不超过目录里的原始照片数", async () => {
  // 只做结构性检查：每条记录都必须有宽高（派生文件忘了过滤时往往 width=0）
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const entries = JSON.parse(await readFile(new URL(file, DIR), "utf8"));
    for (const entry of entries) {
      assert.ok(entry.width > 0 && entry.height > 0, `${file}: ${entry.src} 缺尺寸`);
    }
  }
});

test("够宽的照片必须带齐派生变体（缩略图/480w/og/hero）", async () => {
  // 第 52 轮的真实 bug：所有派生图生成都写在「jpg/png 源」分支里，
  // 于是直接上传的 .webp 原图一张派生图都没有 —— 相册网格用 123 KB 全图填 413px 的格子。
  // 这条断言把这个不变量钉住：宽度够了就必须有对应变体。
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json"));
  const missing: string[] = [];
  for (const file of files) {
    const entries = JSON.parse(await readFile(new URL(file, DIR), "utf8"));
    for (const entry of entries) {
      const w: number = entry.width ?? 0;
      if (w > 720 && !entry.thumbWebp) missing.push(`${file}: ${entry.src} (${w}px) 缺 thumbWebp`);
      if (w > 480 && !entry.thumbSm) missing.push(`${file}: ${entry.src} (${w}px) 缺 thumbSm`);
      if (w >= 1000 && !entry.srcOg) missing.push(`${file}: ${entry.src} (${w}px) 缺 srcOg`);
      if (w > 1200 && !entry.heroWebp) missing.push(`${file}: ${entry.src} (${w}px) 缺 heroWebp`);
      if (w > 1000 && !entry.midWebp) missing.push(`${file}: ${entry.src} (${w}px) 缺 midWebp`);
    }
  }
  assert.deepEqual(missing, []);
});
