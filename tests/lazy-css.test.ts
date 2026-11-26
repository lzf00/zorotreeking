/**
 * 交互后才需要的第三方样式，不许静态 import（第 231 轮）。
 *
 * 背景：`astro.config.mjs` 的 `inlineStylesheets: "always"` 是有意选择（内联比外链快），
 * 但它会把**所有**静态 import 的 CSS 塞进 HTML。Leaflet 的地图样式（14.9 KB）和
 * PhotoSwipe 的灯箱样式（4.4 KB）只有「滚到地图」「点开大图」之后才用得上，
 * 却因此进了 16 个页面的首屏 HTML。这类 CSS 一多，内联策略的好处就被吃光了。
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => readFile(new URL(rel, ROOT), "utf8");

const CLIENT_ONLY_CSS = [
  { pkg: "leaflet", file: "leaflet/dist/leaflet.css", why: "地图底图样式，滚到地图才用" },
  { pkg: "photoswipe", file: "photoswipe/style.css", why: "灯箱样式，点开大图才用" },
];

test("只在交互后需要的第三方样式，必须是 `?url` + 运行期注入", async () => {
  for (const { file, why } of CLIENT_ONLY_CSS) {
    const module = "`" + file + "`";
    const dirs = ["src/components", "src/entrypoints", "src/layouts", "src/pages", "src/lib"];
    const offenders: string[] = [];
    for (const dir of dirs) {
      let entries: string[] = [];
      try {
        entries = await readdir(new URL(`${dir}/`, ROOT), { recursive: true }) as string[];
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!/\.(astro|tsx?|jsx?)$/.test(entry)) continue;
        const source = await read(`${dir}/${entry}`);
        // 静态 import 的两种写法都不行；`?url` 形式是允许的
        if (new RegExp(`import\\s+"${file.replace(/[.]/g, "\\.")}";`).test(source)) {
          offenders.push(`${dir}/${entry}（静态 import）`);
        }
      }
    }
    assert.deepEqual(offenders, [], `${why}：${module} 不许被静态 import，否则会进首屏 HTML`);
  }
});

test("运行期注入的样式表：去重、失败不抛错、不阻塞功能", async () => {
  const source = await read("src/lib/lazy-css.ts");
  assert.match(source, /const pending = new Map/, "同一个 href 要只插一次");
  assert.match(source, /link\.onerror[\s\S]{0,160}resolve\(\)/, "加载失败也要 resolve —— 样式挂了不该让地图/灯箱整个不可用");
  assert.match(source, /CSS\.escape\(href\)/, "选择器里的 href 要转义，否则路径里的特殊字符会炸 querySelector");
});

test("相册的 PhotoSwipe 样式加载发生在灯箱初始化之前，且 import 在 <script> 里", async () => {
  const source = await read("src/components/PhotoGallery.astro");
  const frontmatterEnd = source.indexOf("\n---", 4);
  const frontmatter = source.slice(0, frontmatterEnd);
  const script = source.slice(source.indexOf("<script>"));

  // 第 231 轮踩过：把 import 写在 frontmatter 里，客户端脚本里就是未定义变量，
  // 构建不报错、tsc 也不报错，只有打开灯箱时才会 ReferenceError。
  assert.doesNotMatch(frontmatter, /photoswipe\/style\.css\?url/, "frontmatter 里的变量进不了客户端脚本");
  assert.match(script, /import photoswipeCssUrl from "photoswipe\/style\.css\?url"/);
  assert.match(script, /import \{ loadStylesheet \} from "@\/lib\/lazy-css"/);

  const loadAt = script.indexOf("loadStylesheet(photoswipeCssUrl)");
  const initAt = script.indexOf("lightbox = new PhotoSwipeLightbox(");
  assert.ok(loadAt > 0, "灯箱要把样式一起 await 进来");
  assert.ok(initAt > loadAt, "先等样式，再建灯箱");
});
