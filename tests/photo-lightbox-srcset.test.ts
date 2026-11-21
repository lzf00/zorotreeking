/**
 * 灯箱按显示尺寸挑图（第 127 轮）。
 *
 * 起因：手机上点开相册的一张图，要等**全尺寸** 1600w WebP（本项目最大 603 KB）下载+解码。
 * 给 PhotoSwipe 一份 720w / 1200w / 全尺寸的 srcset，由浏览器按视口与 DPR 挑：
 * DPR 3 的手机挑 1200w（130 KB），DPR 1 挑 720w（24 KB），只有放大时才升到全尺寸。
 *
 * 同一轮还修了 `inp-probe` 的一个测量错误：它点的其实是首图 hero（不在 <a> 里），
 * 灯箱从来没开过，「点开图片 792 ms」量的是不可点图片的绘制。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { buildSrcSet, lightboxVariants } from "../src/lib/photo-srcset";

test("灯箱候选：720 / 1200 / 全尺寸，按宽度升序", () => {
  const set = buildSrcSet(
    lightboxVariants({ thumbWebp: "/a.thumb.webp", midWebp: "/a.mid.webp", srcWebp: "/a.webp", width: 1600 }),
  );
  assert.equal(set, "/a.thumb.webp 720w, /a.mid.webp 1200w, /a.webp 1600w");
});

test("有 hero 变体时用 hero 宽度，不虚标原图宽度", () => {
  const set = buildSrcSet(
    lightboxVariants({ thumbWebp: "/a.thumb.webp", heroWebp: "/a.hero.webp", srcWebp: "/a.webp", width: 4000 }),
  );
  assert.match(set, /\/a\.hero\.webp 1600w$/);
  assert.doesNotMatch(set, /4000w/);
});

test("窄图不会被标成大宽度（否则 1x 屏也硬拉大图）", () => {
  const set = buildSrcSet(lightboxVariants({ thumbWebp: "/s.thumb.webp", midWebp: "/s.mid.webp", width: 600 }));
  // 原图只有 600px：thumb 与 mid 都被夹到 600w，去重后只留第一个（字节更少的那个），
  // 绝不能出现 1200w/1600w 这种虚标宽度
  assert.equal(set, "/s.thumb.webp 600w");
  assert.doesNotMatch(set, /1200w|1600w/);
});

test("组件把 srcset 交给 PhotoSwipe，并带温度（idle 预热）", async () => {
  const src = await readFile(new URL("../src/components/PhotoGallery.tsx", import.meta.url), "utf8");
  assert.match(src, /data-pswp-srcset=\{buildSrcSet\(lightboxVariants\(p\)\)\}/);
  assert.match(src, /warmPhotoSwipe/, "缺少 PhotoSwipe 预热");
  assert.match(src, /requestIdleCallback/, "预热应在空闲时做，不抢首屏");
});

test("探针点的是灯箱链接，不是 hero 图；跳过项不参与最慢评选", async () => {
  const probe = await readFile(new URL("../scripts/inp-probe.mjs", import.meta.url), "utf8");
  assert.match(probe, /a\[data-pswp-width\]/, "探针应优先点 PhotoSwipe 的灯箱链接");
  assert.match(probe, /waitForSelector\("\.pswp"/, "判灯箱开没开要等它挂载");
  assert.match(probe, /filter\(\(i\) => !i\.skipped\)/, "跳过项不能被算成 0 ms 的最快项");
});

test("探针只统计交互类事件（pointerout 不算用户动作）", async () => {
  const probe = await readFile(new URL("../scripts/inp-probe.mjs", import.meta.url), "utf8");
  const block = probe.slice(probe.indexOf("INTERACTION_EVENTS"), probe.indexOf("async function probe"));
  for (const name of ["click", "keydown", "touchstart", "pointerdown"]) {
    assert.ok(block.includes(`"${name}"`), `缺少交互事件类型 ${name}`);
  }
  // 灯箱打开时浏览器补发的 pointerout/pointerleave 会把「最慢」放大到 700 ms 以上，
  // 而用户那一下 click 只有 184 ms —— 它们不能进统计。
  assert.doesNotMatch(block, /"pointer(out|leave|enter|over)"/, "pointer 边界事件不该算作交互延迟");
});
