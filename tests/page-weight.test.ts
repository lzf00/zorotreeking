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

// ── 第 181 轮：线性增长的日志页要判「每条成本」，不判总量 ────────────────
//
// /changelog/ 由 git 历史生成：每多一个提交就长 ~0.8 KB。用「总量 + 10% 漂移」判它，
// 等于每几轮就要重新登记一次基线 —— 而每登记一次，闸门就松一档（第 151 轮就是这么混过去的）。
// 真正该盯的是单条渲染成本。

const { PER_ENTRY_PAGES } = await import("../scripts/lib/page-weight.mjs");

const changelogHtml = (entries: number, perEntryBytes: number) =>
  "<ul>" + Array.from({ length: entries }, () => `<li>${"x".repeat(perEntryBytes)}</li>`).join("") + "</ul>";

test("历史变长、单条成本不变 → 不算回退", () => {
  const html = changelogHtml(500, 900);
  const { failures } = evaluatePages(
    [{ path: "/changelog/", html, htmlBytes: html.length, cssBytes: 0 }],
    { "/changelog/": { htmlBytes: 100 * KB, cssBytes: 0, bytesPerEntry: 900, units: 100, reason: "日志页：判单条成本" } },
  );
  assert.deepEqual(failures, [], "总量从 100 KB 长到 450 KB 也不该红，单条没变");
});

test("单条渲染变贵（模板回退）→ 红", () => {
  const html = changelogHtml(120, 1100);
  const { failures } = evaluatePages(
    [{ path: "/changelog/", html, htmlBytes: html.length, cssBytes: 0 }],
    { "/changelog/": { htmlBytes: 100 * KB, cssBytes: 0, bytesPerEntry: 900, units: 100, reason: "日志页：判单条成本" } },
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /单条成本 900 B → 1\d{3} B/);
});

test("没有单条基线时退回总量判定（兼容旧基线）", () => {
  const html = changelogHtml(10, 900);
  const { failures } = evaluatePages(
    [{ path: "/changelog/", html, htmlBytes: 500 * KB, cssBytes: 0 }],
    { "/changelog/": { htmlBytes: 100 * KB, cssBytes: 0, reason: "旧基线" } },
  );
  assert.equal(failures.length, 1, "没有单条基线时必须还能用总量兜住");
});

test("/changelog/ 已按单条成本登记（回归）", async () => {
  assert.ok(PER_ENTRY_PAGES["/changelog/"], "changelog 应当声明为「按条判定」的页面");
  const { readFile } = await import("node:fs/promises");
  const baseline = JSON.parse(await readFile(new URL("../scripts/page-weight-baseline.json", import.meta.url), "utf8"));
  assert.ok(baseline["/changelog/"].bytesPerEntry > 0, "基线里必须有单条字节数，否则判回总量");
});
