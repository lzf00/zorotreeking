import assert from "node:assert/strict";
import test from "node:test";

import { parseAuditJsonl, summarizeSiteAudit } from "../scripts/lib/summarize-audit.mjs";

test("JSONL 解析：坏行跳过，好行照收", () => {
  const text = [
    '{"url":"/a/","status":200}',
    "不是 JSON",
    "",
    '{"status":200}', // 没有 url，丢掉
    '{"url":"/b/","status":404,"issues":["HTTP 404: /x.webp"]}',
  ].join("\n");
  const rows = parseAuditJsonl(text);
  assert.deepEqual(rows.map((row) => row.url), ["/a/", "/b/"]);
});

test("汇总：失败按问题归组，参数相同的 404 合成一行", () => {
  const rows = [
    { url: "/a/", status: 200, lcp: 400, cls: 0 },
    { url: "/b/", status: 200, lcp: 900, cls: 0.02, issues: ["HTTP 404: /photos/1.webp"] },
    { url: "/c/", status: 404, issues: ["HTTP 404: /photos/2.webp"] },
  ];
  const { markdown, failures, pages } = summarizeSiteAudit(rows);
  assert.equal(pages, 3);
  assert.equal(failures, 2);
  assert.match(markdown, /## 全站巡检：3 页，失败 2 页/);
  // 两个不同文件名归到同一类（把文件名替换成 /…）
  assert.match(markdown, /\| HTTP 404: \/photos\/… \| 2 \|/);
  assert.match(markdown, /\| 0\.020 \| \/b\/ \|/);
});

test("汇总：全绿时明确说通过，不臆造表格", () => {
  const { markdown, failures } = summarizeSiteAudit([
    { url: "/a/", status: 200, lcp: 300, cls: 0 },
    { url: "/b/", status: 200, lcp: 500, cls: 0 },
  ]);
  assert.equal(failures, 0);
  assert.match(markdown, /全部通过/);
  assert.doesNotMatch(markdown, /### 失败归组/);
  // 两页的「中位」取较小值：写 500 会让报告比实际更好看
  assert.match(markdown, /LCP 中位 300 ms/);
});

test("汇总：空报告不崩（线上 sitemap 抓不到时会走到）", () => {
  const { markdown, pages } = summarizeSiteAudit([]);
  assert.equal(pages, 0);
  assert.match(markdown, /报告为空/);
});

test("巡检脚本与 workflow 接线齐全（否则每周跑的是「假绿」）", async () => {
  const { readFile } = await import("node:fs/promises");
  const script = await readFile(new URL("../scripts/audit-site.mjs", import.meta.url), "utf8");
  assert.match(script, /--resume/, "支持续跑：全量 1186 页中途断了不该从头再来");
  assert.match(script, /预热/, "第一次导航是冷的，不预热会把首页量成 2 s+");
  assert.match(script, /并发 \$\{CONCURRENCY\} > 2/, "高并发时 LCP 会被抢占，必须在输出里说明");
  assert.match(script, /serveDist/, "默认跑本地 dist");
  assert.match(script, /process\.exit\(failures\.length \? 1 : 0\)/, "有失败要 exit 1");

  const pkg = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.match(pkg, /"audit:site": "node scripts\/audit-site\.mjs --vitals"/);

  const workflow = await readFile(new URL("../.github/workflows/site-audit.yml", import.meta.url), "utf8");
  assert.match(workflow, /cron: "0 1 \* \* 4"/, "每周四 09:00 北京时间");
  assert.match(workflow, /--base=https:\/\/www\.zorotreeking\.online/, "查线上而不是本地构建");
  assert.match(workflow, /--sitemap=\/tmp\/sitemap\.xml/, "用线上 sitemap 决定范围");
  assert.match(workflow, /continue-on-error: true/, "巡检只报告，不挡部署");
  assert.match(workflow, /GITHUB_STEP_SUMMARY/, "结论要写进 run 页面");
  assert.match(workflow, /actions\/upload-artifact@v4/, "明细留 artifact");
});
