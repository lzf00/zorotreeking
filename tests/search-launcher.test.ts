import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("搜索预取只拉 chunk，不能顺手把面板弹出来", async () => {
  const launcher = await read("src/components/SearchLauncher.astro");
  // 预取走独立的 prefetchSearch，入口是 pointerover / focusin / touchstart
  assert.match(launcher, /function prefetchSearch\(\)/);
  assert.match(launcher, /pointerover[\s\S]{0,200}prefetchSearch\(\)/);
  assert.match(launcher, /focusin[\s\S]{0,200}prefetchSearch\(\)/);
  // 打开面板必须是 loadSearch(true)，不能复用预取函数
  assert.match(launcher, /__openSearch = \(\) => loadSearch\(true\)/);
  assert.doesNotMatch(launcher, /isTrigger\(event\.target\)\) loadSearch\(\)/, "预取不能等于打开");

  const entry = await read("src/entrypoints/search.tsx");
  // 挂载入口要能「静默挂载」，否则预取会把面板弹到用户脸上
  assert.match(entry, /\{ open = true \}: \{ open\?: boolean \} = \{\}/);
  assert.match(entry, /<SearchModal initialOpen=\{open\}/);
});

test("搜索加载失败会回滚状态，允许再次点击重试", async () => {
  const launcher = await read("src/components/SearchLauncher.astro");
  // loading/modulePromise 都要复位，否则一次失败后按钮永远没反应
  assert.match(launcher, /\.catch\(\(error\) => \{\n\s+loading = false;\n\s+modulePromise = null;/);
  // 失败时给用户提示，不是静默
  assert.match(launcher, /search:load-error/);
});
