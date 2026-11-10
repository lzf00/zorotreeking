import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("homepage secondary counts retain WCAG-readable text styling", async () => {
  const component = await readProjectFile("src/components/SectionCard.astro");
  const secondaryCount = component.match(/\{countSecondary && \([\s\S]*?\n\s*\)\}/)?.[0] ?? "";
  assert.doesNotMatch(secondaryCount, /opacity-/);
  assert.match(secondaryCount, /text-\[var\(--text-secondary\)\]/);
  assert.match(secondaryCount, /text-\[11px\]/);
});

test("Astro inlines the render-blocking site stylesheet", async () => {
  const { default: config } = await import("../astro.config.mjs");
  assert.equal(config.build?.inlineStylesheets, "always");
});

test("explore map uses one shared tooltip instead of a title node per point", async () => {
  const page = await readProjectFile("src/pages/explore.astro");
  assert.doesNotMatch(page, /<title>/);
  // tooltip 文本直接复用 aria-label（早前是 data-tooltip 再抄一份）。断言读的是
  // 「共享 tooltip + 每个点有可读名字」，不是具体属性名。
  assert.match(page, /aria-label=\{label\}/);
  assert.match(page, /id="explore-tooltip"/);
  assert.match(page, /role="tooltip"/);
});
