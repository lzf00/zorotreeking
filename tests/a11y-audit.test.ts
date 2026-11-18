import assert from "node:assert/strict";
import { test } from "node:test";
import { groupViolations, sampleEvenly, urlFromIndexFile } from "../scripts/a11y-audit.mjs";

test("dist 的 index.html 映射成站点路径", () => {
  assert.equal(urlFromIndexFile("about/index.html"), "/about/");
  assert.equal(urlFromIndexFile("index.html"), "/");
  assert.equal(urlFromIndexFile("en/topics/index.html"), "/en/topics/");
});

test("等距抽样结果稳定且不重复", () => {
  const items = Array.from({ length: 100 }, (_, i) => `p${i}`);
  const first = sampleEvenly(items, 10);
  assert.deepEqual(first, sampleEvenly(items, 10));
  assert.equal(new Set(first).size, 10);
  // 页数少于抽样数时全给，不补空
  assert.deepEqual(sampleEvenly(["a", "b"], 10), ["a", "b"]);
});

test("同一条违规跨页面合并，并记下命中页数", () => {
  const violation = (id: string, target: string, nodes = 1) => ({
    id,
    impact: "serious",
    help: `${id} help`,
    helpUrl: `https://dequeuniversity.com/rules/axe/${id}`,
    nodes: Array.from({ length: nodes }, () => ({ target: [target] })),
  });
  const grouped = groupViolations([
    { url: "/a/", violations: [violation("color-contrast", ".x")] },
    { url: "/b/", violations: [violation("color-contrast", ".x", 3), violation("image-alt", "img")] },
  ]);
  assert.equal(grouped.length, 2);
  const contrast = grouped.find((v) => v.id === "color-contrast");
  assert.equal(contrast?.pages, 2);
  assert.equal(contrast?.nodes, 3);
  assert.deepEqual(contrast?.pages_list, ["/a/", "/b/"]);
  // serious 排在前面
  assert.equal(grouped[0].id, "color-contrast");
});

test("第三方后台外壳被排除，自家 admin 页面照审", async () => {
  const { EXCLUDED } = await import("../scripts/a11y-audit.mjs");
  assert.deepEqual(EXCLUDED, ["/admin/"]);
  assert.equal(EXCLUDED.includes("/admin/utm/"), false);
  assert.equal(EXCLUDED.includes("/admin/etf-ops/"), false);
});

test("深色模式是单独一轮，结果里带 [dark] 标记", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../scripts/a11y-audit.mjs", import.meta.url), "utf8");
  assert.match(source, /--scheme/);
  assert.match(source, /colorScheme: scheme/);
  assert.match(source, /\[dark\]/);
});

test("涨跌色用设计 token，不再写死单主题的 hex/调色板类", async () => {
  const fs = await import("node:fs/promises");
  const root = new URL("../src/", import.meta.url);
  const etf = await fs.readFile(new URL("pages/invest/etf.astro", root), "utf8");
  assert.match(etf, /var\(--market-up\)/);
  assert.match(etf, /var\(--market-down\)/);
  assert.doesNotMatch(etf, /text-emerald-700(?![\s\S]*dark:)/);
  // 主题页的板块色必须走 token，写死 hex 会在深色底上掉到 2.4:1
  const topics = await fs.readFile(new URL("components/TopicsCloud.astro", root), "utf8");
  assert.match(topics, /--section-\$\{section\}-rgb/);
  assert.doesNotMatch(topics, /ai: "#1d4ed8"/);
});

test("视口可配置，默认桌面 1280x900", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../scripts/a11y-audit.mjs", import.meta.url), "utf8");
  assert.match(source, /--viewport/);
  assert.match(source, /Number\.isFinite\(vpWidth\)/);
});

test("横向滚动的表格容器都能用键盘聚焦（WCAG 2.1.1）", async () => {
  const fs = await import("node:fs/promises");
  const root = new URL("../src/", import.meta.url);
  const offenders = [];
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(astro|tsx)$/.test(entry.name)) continue;
      const source = await fs.readFile(full, "utf8");
      for (const line of source.split("\n")) {
        if (!line.includes("overflow-x-auto")) continue;
        if (/tabindex|tabIndex/.test(line)) continue;
        offenders.push(`${full.pathname}: ${line.trim().slice(0, 80)}`);
      }
    }
  };
  await walk(root);
  assert.deepEqual(offenders, []);
});
