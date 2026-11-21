/**
 * 点赞接口的可用性要被部署验收盯住（第 104 轮）。
 *
 * 背景：线上 `GET /api/feedback?slug=…` 长期返回 422，导致每篇文章底部的
 * 「N 人觉得有用」从来显示不出来 —— 前端静默降级把它吞掉了，所以**没有任何地方会红**，
 * 坏了很久才被发现。这类"接口挂了但页面看起来正常"的故障，只有主动探针能抓到。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const deploy = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");

test("部署验收会打一次点赞接口探针", () => {
  assert.match(deploy, /\/api\/feedback\?slug=item%3Adeploy-probe/, "验收里没有点赞接口探针");
  for (const key of ["likes", "dislikes", "my_vote"]) {
    assert.ok(deploy.includes(`"${key}"`), `探针没校验返回字段 ${key}`);
  }
});

test("探针只用只读 GET，不写投票数据", () => {
  const block = deploy.slice(deploy.indexOf("/api/feedback?slug=item%3Adeploy-probe") - 400, deploy.indexOf("/api/feedback?slug=item%3Adeploy-probe") + 600);
  assert.doesNotMatch(block, /data=/, "探针不该发 POST body");
  assert.doesNotMatch(block, /method="POST"/, "探针不该用 POST");
});

test("前端仍保留降级路径（后端再挂也不能让按钮点不动）", async () => {
  const cache = await readFile(new URL("../src/lib/feedback-cache.ts", import.meta.url), "utf8");
  assert.match(cache, /loadFeedbackOrEmpty/, "降级加载函数被删了");
  assert.match(cache, /catch \{/, "没有 catch 就谈不上降级");
});
