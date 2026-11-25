/**
 * giscus 评论到底连没连上仓库（第 208 轮）。
 *
 * 线上实测（2026-11-26）：/guestbook/ 的评论 iframe 稳定请求
 *   https://giscus.app/api/discussions?repo=lzf00%2Fzorotreeking&term=guestbook&category=General…
 * 并返回 404。原因通常是 giscus GitHub App 没装到仓库上。
 *
 * 页面自己发现不了：iframe 跨域，CORS 只给 giscus.app 自己（`access-control-allow-origin:
 * https://giscus.app`），父页面读不到状态。所以判定放到构建期/CI，用真参数打一次 API。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { discussionsUrl, judgeGiscus } from "../scripts/check-giscus.mjs";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

test("URL 参数与 giscus client.js 一致（repo/term/category/number/strict/first）", () => {
  const url = new URL(discussionsUrl({ repo: "lzf00/zorotreeking", term: "guestbook" }));
  assert.equal(url.origin + url.pathname, "https://giscus.app/api/discussions");
  assert.equal(url.searchParams.get("repo"), "lzf00/zorotreeking");
  assert.equal(url.searchParams.get("term"), "guestbook");
  assert.equal(url.searchParams.get("category"), "General", "默认分类");
  assert.equal(url.searchParams.get("number"), "0");
  assert.equal(url.searchParams.get("strict"), "false");
  assert.equal(url.searchParams.get("first"), "15");
});

test("分类可覆盖（secrets 里配的是 Announcements）", () => {
  const url = new URL(discussionsUrl({ repo: "a/b", category: "Announcements", term: "guestbook" }));
  assert.equal(url.searchParams.get("category"), "Announcements");
});

test("200 → 通；404 → 给得出可执行的修法；其它 → 不下结论", () => {
  const ok = judgeGiscus(200);
  assert.equal(ok.level, "ok");

  const broken = judgeGiscus(404);
  assert.equal(broken.level, "broken");
  assert.match(broken.message, /apps\/giscus/, "要给出装 App 的地址");
  assert.match(broken.message, /Discussions/);
  assert.match(broken.message, /data-repo-id/, "要提醒重新生成 id 写进 secrets");

  for (const status of [403, 500, 502]) {
    assert.equal(judgeGiscus(status).level, "unknown", `${status} 不该被当成"坏了"`);
  }
});

test("探测永远不拦发布（配置状态，不是代码正确性）", async () => {
  const src = await read("scripts/check-giscus.mjs");
  assert.match(src, /exit\(0\)/, "结尾必须无条件 0");
  assert.ok(!/process\.exit\(1\)/.test(src), "不许用退出码 1 卡部署");
});

test("CI 里是 warn-only，且用与构建相同的变量", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  const at = workflow.indexOf("- name: Comment service (warn only)");
  assert.ok(at > 0, "deploy.yml 里要有这一步");
  const block = workflow.slice(at, at + 800);
  assert.match(block, /continue-on-error: true/);
  assert.match(block, /PUBLIC_GISCUS_REPO/);
  assert.match(block, /GITHUB_STEP_SUMMARY/);
});

test("留言板两页都有「服务没连上时的备选路径」提示", async () => {
  const zh = await read("src/pages/guestbook.astro");
  assert.match(zh, /一片空白或者显示无法加载/);
  assert.match(zh, /访客留言/, "要指向仍可用的访客留言");
  const en = await read("src/pages/en/guestbook.astro");
  assert.match(en, /blank or fails to load/);
  assert.match(en, /guest message above or email below/);
});
