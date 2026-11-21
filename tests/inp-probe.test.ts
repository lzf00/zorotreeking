import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, summarize } from "../scripts/inp-probe.mjs";

test("默认打生产、桌面视口、四个交互页", () => {
  const args = parseArgs([]);
  assert.equal(args.base, "https://www.zorotreeking.online");
  assert.equal(args.mobile, false);
  assert.ok(args.urls.length >= 4);
});

test("可指定 base / urls / 手机视口", () => {
  const args = parseArgs(["--base", "http://127.0.0.1:8945", "--urls", "/a/,/b/", "--mobile"]);
  assert.equal(args.base, "http://127.0.0.1:8945");
  assert.deepEqual(args.urls, ["/a/", "/b/"]);
  assert.equal(args.mobile, true);
});

test("summary 取每页最慢的那次交互，并标出超过 200 ms 的页面", () => {
  const report = [
    {
      path: "/slow/",
      interactions: [
        { action: "点开灯箱", ms: 16, median: 16 },
        { action: "点按钮「喜欢」", ms: 280, median: 280 },
      ],
      errors: [],
    },
    {
      path: "/fast/",
      interactions: [{ action: "拖动地图", ms: 0, median: 0 }],
      errors: ["boom"],
    },
    { path: "/empty/", interactions: [], errors: [] },
  ];
  const rows = summarize(report);
  assert.deepEqual(rows.map((r) => [r.path, r.worstMs]), [
    ["/slow/", 280],
    ["/fast/", 0],
    ["/empty/", 0],
  ]);
  assert.equal(rows[0].worstAction, "点按钮「喜欢」");
  assert.equal(rows[1].errors, 1, "页面 JS 错误要计数，不能被吞掉");
  assert.equal(rows[2].worstAction, "—", "没有可点元素时不能崩");
});

test("--fail-on-404 会被解析并用于月度清单的退出码", () => {
  const args = parseArgs(["--fail-on-404"]);
  assert.equal(args.failOn404, true);
  assert.equal(parseArgs([]).failOn404, false);
});
