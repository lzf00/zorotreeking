/**
 * 相册 alt 不能是文件名（第 152 轮，欠账 #14）。
 *
 * 原来的 alt 是 `path.basename()`：读屏用户听到的是
 * `ChatGPT Image 2026年6月3日 18_34_40`、`13408098752635440` —— 等于没有 alt。
 * 现在按「相册名 · 地点 · 月份 · 第 N 张」组装，中英各一份。
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const MANIFEST_DIR = new URL("../src/data/photo-manifest/", import.meta.url);

type Entry = { src: string; alt: string; altEn?: string };

async function loadAll(): Promise<Array<{ album: string; entries: Entry[] }>> {
  const files = (await readdir(MANIFEST_DIR)).filter((f) => f.endsWith(".json"));
  return Promise.all(
    files.map(async (file) => ({
      album: file.replace(/\.json$/, ""),
      entries: JSON.parse(await readFile(new URL(file, MANIFEST_DIR), "utf8")) as Entry[],
    })),
  );
}

test("没有一张照片的 alt 还是文件名", async () => {
  const albums = await loadAll();
  assert.ok(albums.length > 0, "没有 manifest，测不出东西");
  const bad: string[] = [];
  for (const { album, entries } of albums) {
    for (const entry of entries) {
      const fileName = decodeURIComponent(entry.src.split("/").pop() ?? "");
      const stem = fileName.replace(/\.[^.]+$/, "");
      if (entry.alt === stem || entry.alt === fileName) bad.push(`${album}: ${entry.alt}`);
      // 纯数字 / 相机导出常见的 `IMG_1234`，都不是给人读的
      if (/^\d{6,}$/.test(entry.alt) || /^(IMG|DSC|PXL)[-_]?\d/i.test(entry.alt)) bad.push(`${album}: ${entry.alt}`);
    }
  }
  assert.deepEqual(bad, [], `这些 alt 还是文件名：${bad.slice(0, 5).join(" | ")}`);
});

test("alt 说清「哪本相册、第几张、共几张」", async () => {
  for (const { album, entries } of await loadAll()) {
    for (const [index, entry] of entries.entries()) {
      const position = index + 1;
      assert.match(
        entry.alt,
        new RegExp(`第 ${position} 张，共 ${entries.length} 张`),
        `${album} 第 ${position} 张的位置信息不对：${entry.alt}`,
      );
      assert.ok(entry.alt.length <= 125, `alt 太长（${entry.alt.length} 字），读屏会念很久：${entry.alt}`);
    }
  }
});

test("英文页有英文 alt，不是把中文 alt 直接搬过去", async () => {
  const albums = await loadAll();
  const withEn = albums.filter(({ entries }) => entries.some((entry) => entry.altEn));
  assert.ok(withEn.length > 0, "一条 altEn 都没有");
  for (const { album, entries } of withEn) {
    for (const [index, entry] of entries.entries()) {
      assert.ok(entry.altEn, `${album} 第 ${index + 1} 张缺 altEn`);
      assert.match(entry.altEn!, new RegExp(`photo ${index + 1} of ${entries.length}`), `英文格式不对：${entry.altEn}`);
    }
  }
});

test("生成器和组件都按语言取 alt（别只改数据不改出口）", async () => {
  const builder = await readFile(new URL("../scripts/build-photo-manifests.ts", import.meta.url), "utf8");
  assert.match(builder, /readAlbumMeta\(albumSlug, "zh"\)/, "要读中文相册元信息");
  assert.match(builder, /readAlbumMeta\(albumSlug, "en"\)/, "要读英文相册元信息");
  assert.ok(!/alt: path\.basename/.test(builder), "不能再退回文件名");

  const gallery = await readFile(new URL("../src/components/PhotoGallery.tsx", import.meta.url), "utf8");
  assert.match(gallery, /const alt = photoAlt\(p, lang\)/, "组件要按 lang 选 alt");
  assert.ok(!/alt=\{p\.alt\}|aria-label=\{p\.alt\}/.test(gallery), "还有地方直接用中文 alt");

  const enPage = await readFile(new URL("../src/pages/en/photo/[slug].astro", import.meta.url), "utf8");
  assert.match(enPage, /lang="en"/, "英文相册页要把 lang 传下去");
  assert.match(enPage, /photoAlt\(cover, "en"\)/, "英文页封面 alt 也要本地化");
});
