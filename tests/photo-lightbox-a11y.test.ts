/**
 * 照片灯箱的键盘/读屏契约（第 141 轮）。
 *
 * 实测修复前：点开后焦点仍在背后的照片链接上、没有 aria-modal、Tab 走完 4 个按钮
 * 就跑到 BODY；prefers-reduced-motion 下关闭后焦点落在 <body>（恰好是最需要键盘的人）。
 * 真正的判定在 scripts/check-a11y.mjs（真按键），这里锁住实现没被改回去。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("灯箱要有 aria-modal、可读标签、初始焦点与焦点陷阱", async () => {
  const gallery = await read("src/components/PhotoGallery.tsx");
  assert.match(gallery, /setAttribute\("aria-modal", "true"\)/);
  assert.match(gallery, /图片查看器/, "要告诉读屏用户怎么操作");
  assert.match(gallery, /pswp__button--close/, "打开后应把焦点移到关闭按钮");
  assert.match(gallery, /function handleKeyDown|const handleKeyDown|onKeyDown/, "缺 Tab 处理");
  assert.match(gallery, /keydown", onKeyDown/, "Tab 处理没挂上");
});

test("焦点归还必须等 DOM 拆完（reduced-motion 下尤其）", async () => {
  const gallery = await read("src/components/PhotoGallery.tsx");
  assert.match(gallery, /lightbox\.on\("destroy"/, "要在 destroy 后回归焦点，太早会被拆 DOM 覆盖");
  assert.match(gallery, /triggerElement/, "要记住打开它的那张照片");
  assert.match(gallery, /active !== document\.body/, "只在焦点真丢了时介入，别抢 PhotoSwipe 正确的路径");
});

test("门禁里的灯箱检查必须真的跑（相册页在快检路径里）", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.scripts["check:a11y:fast"], /photo\/baokemeng/, "门禁路径不含相册页，灯箱契约就没人验");
  const check = await read("scripts/check-a11y.mjs");
  assert.match(check, /lightbox-keyboard/);
  assert.match(check, /焦点跑出灯箱/);
  assert.match(check, /关闭后焦点没有回到照片/);
});
