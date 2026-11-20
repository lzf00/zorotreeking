/**
 * 内容新鲜度 → commit status（第 85 轮）。
 *
 * 事故背景：AI 日报静默停更三天，期间站点构建、门禁、巡检全绿 —— 因为「内容断了」
 * 不在任何健康检查的信号里，而 Actions 日志要登录才能看。把新鲜度挂成 commit status 后，
 * 打开任意一次提交就能看到「AI 日报 落后 3 天」，不需要日志权限。
 *
 * 关键约束：这个 status **不阻塞部署**（内容落后不该挡住代码修复的发布），
 * 所以它在 deploy.yml 里必须是 continue-on-error。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

import { CONTEXT, buildStatus } from "../scripts/publish-freshness-status.mjs";

const row = (over = {}) => ({ id: "ai-digest", label: "AI 日报", newest: "2026-11-18", age: 3, level: "fail", reason: "", ...over });

test("有流过期时状态为 failure，且描述说清「落后几天」", () => {
  const status = buildStatus({ ok: false, rows: [row(), row({ id: "invest", label: "投资复盘", newest: "2026-11-20", age: 1, level: "ok" })] });
  assert.equal(status.state, "failure");
  assert.equal(status.context, CONTEXT);
  assert.match(status.description, /AI 日报 落后 3 天/);
  assert.ok(!status.description.includes("投资复盘"), "达标的那条不该出现在失败描述里");
});

test("完全没产出时给出可读原因，而不是「落后 null 天」", () => {
  const status = buildStatus({ ok: false, rows: [row({ newest: null, age: null })] });
  assert.equal(status.state, "failure");
  assert.match(status.description, /没有产出/);
  assert.ok(!status.description.includes("null"));
});

test("全部达标时是 success，并带上最新一篇的日期", () => {
  const status = buildStatus({ ok: true, rows: [row({ age: 0, level: "ok" })] });
  assert.equal(status.state, "success");
  assert.match(status.description, /2026-11-18/);
});

test("描述长度不超过 GitHub 的 140 字符上限", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row({ label: `第${i}条日报数据流`, age: 9 }));
  const status = buildStatus({ ok: false, rows });
  assert.ok(status.description.length <= 140, `描述过长：${status.description.length}`);
});

test("部署里以 continue-on-error 上报（内容落后不能挡住发布）", async () => {
  const deploy = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const at = deploy.indexOf("name: Publish content freshness status");
  assert.ok(at > 0, "部署里要有新鲜度上报步骤");
  const block = deploy.slice(at, at + 400);
  assert.match(block, /continue-on-error: true/, "这一步失败不能拖垮部署");
  assert.match(block, /publish-freshness-status\.mjs/);

  // 顺带确认这个步骤在 YAML 里语法合法、并且排在部署步骤之前
  const doc = parse(deploy);
  const steps = doc.jobs["build-and-deploy"].steps;
  const index = steps.findIndex((step) => step.name === "Publish content freshness status");
  assert.ok(index > 0, "步骤要真的存在于 job 里");
  assert.equal(steps[index]["continue-on-error"], true);
  const activate = steps.findIndex((step) => step.name === "Activate release atomically");
  assert.ok(index < activate, "新鲜度上报要在激活之前完成（否则失败也来不及提示）");
});
