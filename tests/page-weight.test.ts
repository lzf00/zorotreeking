/**
 * 页面重量闸门（第 131 轮）。
 *
 * 起因：`/hike/travel/ali-grand-loop-lhasa-return-2026/` 的 LCP 在 CI 里 1.19 s ↔ 2.66 s 来回跳。
 * 查下去是这页 HTML **309 KB**（中位页面 182 KB），慢网下光传输就 1.5 s。
 * 全站 1198 页里 242 页超过 200 KB，最重 429 KB —— 这类问题不报错、不全红，只会悄悄变重。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { BUDGETS, evaluatePages, parseStyleBytes } from "../scripts/lib/page-weight.mjs";

const KB = 1024;

test("多块 style 的内联 CSS 要加起来算", () => {
  const html = `<html><head><style>a{color:red}</style><style>b{color:blue}</style></head></html>`;
  assert.equal(parseStyleBytes(html), "a{color:red}".length + "b{color:blue}".length);
});

test("新页面超过 HTML / CSS 预算都要红", () => {
  const { failures } = evaluatePages(
    [
      { path: "/ok/", htmlBytes: 150 * KB, cssBytes: 90 * KB },
      { path: "/heavy/", htmlBytes: 300 * KB, cssBytes: 90 * KB },
      { path: "/css-heavy/", htmlBytes: 150 * KB, cssBytes: 140 * KB },
    ],
    {},
  );
  assert.deepEqual(failures.map((f) => f.path), ["/heavy/", "/css-heavy/"]);
  assert.equal(failures[0].kind, "html");
  assert.equal(failures[1].kind, "css");
});

test("基线页面按自己的尺寸放行，但再长 10% 就要重新审", () => {
  const baseline = { "/invest/digest/": { htmlBytes: 429 * KB, cssBytes: 92 * KB, reason: "列表页" } };
  const atBaseline = evaluatePages([{ path: "/invest/digest/", htmlBytes: 429 * KB, cssBytes: 92 * KB }], baseline);
  assert.equal(atBaseline.failures.length, 0, "基线原值必须放行，否则闸门一上线就是红的");
  assert.equal(atBaseline.warnings.length, 0);

  const slight = evaluatePages([{ path: "/invest/digest/", htmlBytes: 445 * KB, cssBytes: 92 * KB }], baseline);
  assert.equal(slight.failures.length, 0, "10% 以内只告警");
  assert.match(slight.warnings[0], /比基线重了/);

  const drift = evaluatePages([{ path: "/invest/digest/", htmlBytes: 480 * KB, cssBytes: 92 * KB }], baseline);
  assert.equal(drift.failures.length, 1);
  assert.equal(drift.failures[0].kind, "html-drift");
  assert.match(drift.failures[0].message, /列表页/, "报错要说清为什么这页原本就大");
});

test("路线页内联 CSS 超 120 KB 也能进基线（地图样式是既有设计）", () => {
  const baseline = { "/hike/travel/x/": { htmlBytes: 200 * KB, cssBytes: 140 * KB, reason: "路线页" } };
  const rows = evaluatePages([{ path: "/hike/travel/x/", htmlBytes: 200 * KB, cssBytes: 140 * KB }], baseline);
  assert.equal(rows.failures.length, 0);
});

test("基线里已经不存在的页面会提示清理", () => {
  const { warnings } = evaluatePages([{ path: "/a/", htmlBytes: 10 * KB, cssBytes: 1 * KB }], { "/gone/": { htmlBytes: 300 * KB, cssBytes: 90 * KB, reason: "x" } });
  assert.match(warnings.join(), /\/gone\/ 已不存在/);
});

test("gzip 超预算要红：传输成本和原始字节是两件事", () => {
  // /archive/ 347 KB raw 但只有 32 KB gzip；路线页反过来：raw 309 KB、gzip 79 KB
  const { failures } = evaluatePages([
    { path: "/list/", htmlBytes: 340 * KB, cssBytes: 92 * KB, gzipBytes: 32 * KB, tags: 2600 },
    // 只看 gzip：raw/CSS/标签都在预算内（真实世界里这三样容易一起超，测试要能单独验 gzip）
    { path: "/route/", htmlBytes: 200 * KB, cssBytes: 100 * KB, gzipBytes: 79 * KB, tags: 900 },
  ], { "/list/": { htmlBytes: 347 * KB, cssBytes: 92 * KB, gzipBytes: 32 * KB, tags: 2600, reason: "列表页" } });
  assert.deepEqual(failures.map((f) => f.kind), ["gzip"], "只有 gzip 超标的那页该红");
  assert.match(failures[0].message, /gzip/);
});

test("标签数超预算要红：DOM 节点也是成本", () => {
  const { failures } = evaluatePages([{ path: "/x/", htmlBytes: 100 * KB, cssBytes: 10 * KB, gzipBytes: 20 * KB, tags: 3600 }], {});
  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, "tags");
});

test("基线页面的 gzip 再长 10% 也要重新审", () => {
  const baseline = { "/route/": { htmlBytes: 309 * KB, cssBytes: 140 * KB, gzipBytes: 70 * KB, tags: 2000, reason: "路线页地图样式" } };
  assert.equal(evaluatePages([{ path: "/route/", htmlBytes: 309 * KB, cssBytes: 140 * KB, gzipBytes: 74 * KB, tags: 2000 }], baseline).failures.length, 0);
  const drift = evaluatePages([{ path: "/route/", htmlBytes: 309 * KB, cssBytes: 140 * KB, gzipBytes: 82 * KB, tags: 2000 }], baseline);
  assert.equal(drift.failures[0].kind, "gzip-drift");
  assert.match(drift.failures[0].message, /路线页地图样式/, "报错要带基线理由");
});

test("真实基线：每条都有理由，且确实超预算（没有白名单滥用）", async () => {
  const baseline = JSON.parse(await readFile(new URL("../scripts/page-weight-baseline.json", import.meta.url), "utf8"));
  const entries = Object.entries(baseline) as Array<[string, { htmlBytes: number; cssBytes: number; reason: string }]>;
  assert.ok(entries.length > 0 && entries.length < 60, `基线条目数异常：${entries.length}`);
  for (const [path, item] of entries) {
    assert.ok(item.reason && item.reason.length > 6, `${path} 缺少理由`);
    assert.match(path, /^\/.*\/$/, `${path} 路径格式不对`);
    const over =
      item.htmlBytes > BUDGETS.htmlBytes ||
      item.cssBytes > BUDGETS.cssBytes ||
      item.gzipBytes > BUDGETS.gzipBytes ||
      item.tags > BUDGETS.tags;
    assert.ok(over, `${path} 没超任何预算却被登记进基线`);
  }
});

test("门禁在 build 之后跑 check:weight", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const gate: string = pkg.scripts.gate;
  assert.match(gate, /check:weight/, "gate 里没有页面重量检查");
  assert.ok(gate.indexOf("check:weight") > gate.indexOf(" build "), "check:weight 必须在 build 之后（要读 dist）");
  assert.match(pkg.scripts["check:weight"], /check-page-weight\.mjs/);
});
