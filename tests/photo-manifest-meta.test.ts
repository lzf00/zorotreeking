/**
 * 相册文件夹名和内容文件名不一致时，alt 不能退化（第 170 轮）。
 *
 * `public/photos/uploads/mac1/` 对应的是 `src/content/photo/123.zh.mdx`
 * （`translationKey: mac1`）。生成器原来只按文件夹名找 `mac1.zh.mdx`，找不到就把
 * 相册标题 / 地点 / 时间全丢掉，alt 变成「第 1 张，共 6 张」——12 张照片的朗读信息没了。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const manifest = async (name: string) => JSON.parse(await read(`src/data/photo-manifest/${name}.json`)) as Array<{ alt: string; altEn?: string }>;

test("名称不一致的相册（mac1 ← 123.mdx）也带得上标题与地点", async () => {
  const photos = await manifest("mac1");
  assert.match(photos[0].alt, /海贼王/, "中文 alt 应有相册标题");
  assert.match(photos[0].alt, /上海/, "中文 alt 应有地点");
  assert.match(photos[0].altEn ?? "", /One Piece/, "英文 alt 应有英文标题");
  assert.match(photos[0].altEn ?? "", /Shanghai/, "英文 alt 应是英文地点");
});

test("正常的相册不受影响（baokemeng）", async () => {
  const photos = await manifest("baokemeng");
  assert.match(photos[0].alt, /宝可梦/);
  assert.match(photos[0].altEn ?? "", /Pokémon/);
});

test("生成器保留了 translationKey 反查这条兜底", async () => {
  const source = await read("scripts/build-photo-manifests.ts");
  assert.match(source, /resolveAlbumFile/);
  assert.match(source, /translationKey/);
});
