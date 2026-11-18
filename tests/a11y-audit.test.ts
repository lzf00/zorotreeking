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
