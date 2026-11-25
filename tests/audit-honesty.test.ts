/**
 * 巡检的"空结果"与"没打开"都不能算通过（第 199 轮）。
 *
 * 事故现场（本地强制跑每周巡检时撞上）：巡检和一次构建并行，dist 正在被删掉重建，
 * 于是
 *   - `audit-site` 读不到 sitemap → 退回目录扫描 → 也扫不到 index.html → **0 页** →
 *     退出码 0，报告里写着「全量巡检 0 页 ✅ 无异常」；
 *   - a11y 巡检把静态服务的兜底文本当成首页，axe 报出「缺 <title> / 缺 lang /
 *     内容不在 landmark 里」——三条严肃违规全是假的。
 *
 * 共同点：**测量工具在什么都没测到时报告了成功**。这类"绿着的空转"比红更危险，
 * 因为它会让人以为查过了。三条断言分别锁住这三个出口。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("全量巡检 0 页必须判失败（不是「✅ 无异常」）", async () => {
  const source = await read("scripts/audit-site.mjs");
  assert.match(source, /if \(results\.length === 0\)/, "缺 0 页判定");
  assert.match(source, /巡检 0 页/, "0 页时要说明「没巡检成」");
  // 这个判定必须排在 process.exit(failures...) 之前
  assert.ok(
    source.indexOf("results.length === 0") < source.indexOf("process.exit(failures.length ? 1 : 0)"),
    "0 页判定要在最终退出码之前",
  );
});

test("每周巡检把 0 页当成错误，而不是写成 ✅", async () => {
  const source = await read("scripts/weekly-audit.mjs");
  assert.match(source, /stats\.pages === 0/, "缺 0 页保护");
  assert.match(source, /::error title=每周巡检·全量巡检::/, "要发 ::error 而不是静默");
});

test("无障碍巡检遇到非 200 响应：既不算通过，也不判 WCAG 违规", async () => {
  const source = await read("scripts/check-a11y.mjs");
  assert.match(source, /const status = response\?\.status\(\) \?\? 0;/, "要读 HTTP 状态码");
  assert.match(source, /页面没打开，不能据此判无障碍/, "要说明这是「没测成」");
  assert.match(source, /failures \+= 1;/, "没测成也要计入失败");
});

test("CI 里的测试失败，不登录也能看见原因", async () => {
  const source = await read(".github/workflows/deploy.yml");
  const step = source.slice(source.indexOf("- name: Unit and guard tests"), source.indexOf("- name: Build photo manifests"));
  assert.match(step, /npm test/, "仍然跑整套测试");
  assert.match(step, /GITHUB_STEP_SUMMARY/, "失败摘要要写进 step summary");
  assert.match(step, /::error title=测试失败::/, "失败的测试名要发注解");
  assert.match(step, /exit 1/, "失败仍要让这一步红");
  assert.doesNotMatch(step, /continue-on-error: true/, "测试步骤不许吞失败");
});

test("sitemap 里每一条 URL 都有 lastmod（归档/更新日志首页不再缺席）", async () => {
  const source = await read("src/pages/sitemap.xml.ts");
  assert.match(source, /"\/archive": latestOf\(/, "归档首页要有 lastmod 来源");
  assert.match(source, /"\/en\/archive": latestOf\(/, "英文归档首页要有 lastmod 来源");
  assert.match(source, /newestChangelog/, "更新日志首页的 lastmod 要取最新一条提交");
});
