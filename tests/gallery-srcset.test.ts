import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const MANIFEST_DIR = new URL("../src/data/photo-manifest/", import.meta.url);

test("带 thumbSm 的条目必须是 .thumb480.webp，且同时有 720w 版本", async () => {
  const files = (await readdir(MANIFEST_DIR)).filter((f) => f.endsWith(".json"));
  let with480 = 0;
  for (const file of files) {
    const entries = JSON.parse(await readFile(new URL(file, MANIFEST_DIR), "utf8"));
    for (const entry of entries) {
      if (!entry.thumbSm) continue;
      with480 += 1;
      assert.match(entry.thumbSm, /\.thumb480\.webp$/, `${file}: thumbSm 命名不对 ${entry.thumbSm}`);
      if (entry.width > 720) {
        assert.ok(entry.thumbWebp, `${file}: ${entry.src} 宽 ${entry.width} 却没有 720w 缩略图`);
      }
    }
  }
  assert.ok(with480 > 0, "至少应有一张图带 480w 缩略图");
});

test("相册网格用 srcset + sizes 而不是单一路径", async () => {
  const src = await readFile(new URL("../src/components/PhotoGallery.tsx", import.meta.url), "utf8");
  assert.match(src, /function srcSetFor\(/, "应有 srcSetFor 组装 720w/480w");
  assert.match(src, /Math\.min\(720, p\.width \|\| 720\)/, "720w 描述符要用真实宽度，不能虚标");
  assert.match(src, /Math\.min\(480, p\.width \|\| 480\)/, "480w 描述符要用真实宽度");
  // sizes 必须跟列数一致：单列 100vw / 两列 50vw / 三列 33vw
  assert.match(src, /\(min-width: 1024px\) 33vw, \(min-width: 640px\) 50vw, 100vw/);
  assert.equal((src.match(/srcSet=\{srcSetFor\(p\)\}/g) ?? []).length, 1);
});
