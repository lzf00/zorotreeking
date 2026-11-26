/**
 * 「内容进了仓库，但站点没上线」（第 213 轮）。
 *
 * 事故：2026-11-24/25，daily-digest 连续四次挂在 deploy 的 `Unit and guard tests`。
 * 抓取 job 是成功的 —— 日报内容已经在 main 里，只是部署被拦下，线上两天没更新，
 * 而所有看门狗都是绿的，因为 `check-freshness.mjs` 只数**仓库里的文件名**。
 *
 * 这里锁住「发了没发」这条判定。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  beijingDay,
  contentPath,
  judgeDeployFreshness,
  newestDate,
} from "../scripts/check-deploy-freshness.mjs";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const NOW = new Date("2026-11-26T01:30:00Z");

test("从文件名里取最新日期", () => {
  const names = ["digest-2026-11-23.zh.mdx", "digest-2026-11-25.zh.mdx", "digest-2026-11-24.en.mdx", "readme.md"];
  assert.equal(newestDate(names, /^digest-(\d{4}-\d{2}-\d{2})\.zh\.mdx$/), "2026-11-25");
  assert.equal(newestDate(["readme.md"], /^digest-(\d{4}-\d{2}-\d{2})\.zh\.mdx$/), null);
});

test("构建时间按北京时间算日期（UTC 深夜 = 北京第二天）", () => {
  assert.equal(beijingDay("2026-11-25T20:00:00Z"), "2026-11-26");
  assert.equal(beijingDay("2026-11-25T01:00:00Z"), "2026-11-25");
  assert.equal(beijingDay("不是时间"), null);
});

test("事故复现：稿子 11-25 进仓库，线上还是 11-23 的构建 → 必须报出来", () => {
  const verdict = judgeDeployFreshness({
    streams: [
      { id: "ai-digest", newest: "2026-11-25", liveStatus: 404 },
      { id: "invest-recap", newest: "2026-11-25", liveStatus: 404 },
    ],
    builtAt: "2026-11-23T10:00:00Z",
    now: NOW,
  });
  assert.equal(verdict.ok, false);
  const joined = verdict.problems.join("\n");
  assert.match(joined, /内容进了仓库但没上线/);
  assert.match(joined, /线上是 404/);
});

test("构建时间够新、线上 200 → 正常，不误报", () => {
  const verdict = judgeDeployFreshness({
    streams: [{ id: "ai-digest", newest: "2026-11-25", liveStatus: 200 }],
    builtAt: "2026-11-26T01:17:00Z",
    now: NOW,
  });
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.ok, true);
  assert.match(verdict.notes.join(" "), /北京时间 2026-11-26/);
});

test("部署太久没动静也要报（哪怕内容日期看着对得上）", () => {
  const verdict = judgeDeployFreshness({
    streams: [{ id: "ai-digest", newest: "2026-11-20", liveStatus: 200 }],
    builtAt: "2026-11-24T00:00:00Z",
    maxLagHours: 30,
    now: NOW,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join(" "), /部署流水线可能停了/);
});

test("读不到 deploy-meta.json 不能当通过（那正是我要查的东西）", () => {
  const verdict = judgeDeployFreshness({ streams: [], builtAt: null, now: NOW });
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems[0], /deploy-meta\.json/);
});

test("线上 5xx 是站点故障，也要报", () => {
  const verdict = judgeDeployFreshness({
    streams: [{ id: "invest-digest", newest: "2026-11-25", liveStatus: 502 }],
    builtAt: "2026-11-26T01:00:00Z",
    now: NOW,
  });
  assert.match(verdict.problems.join(" "), /502/);
});

test("内容路径与站点路由一致", () => {
  assert.equal(contentPath("ai-digest", "2026-11-25"), "/ai/digest-2026-11-25/");
  assert.equal(contentPath("invest-digest", "2026-11-25"), "/invest/digest-2026-11-25/");
  assert.equal(contentPath("invest-recap", "2026-11-25"), "/invest/market-recap-2026-11-25/");
  assert.equal(contentPath("unknown", "2026-11-25"), null);
});

test("freshness-watch 里真的会跑它，而且是失败即红的步骤", async () => {
  const wf = await read(".github/workflows/freshness-watch.yml");
  assert.match(wf, /node scripts\/check-deploy-freshness\.mjs/, "workflow 没接线 = 这个探针没人跑");
  assert.match(wf, /内容进了仓库但没上线/, "失败时要有能看懂的注解");
  // 必须排在「仓库有没有今天的稿子」之后：先看有没有写，再看有没有发
  assert.ok(
    wf.indexOf("check-freshness.mjs") < wf.indexOf("check-deploy-freshness.mjs") ||
      wf.indexOf("publish-freshness-issue.mjs") < wf.indexOf("check-deploy-freshness.mjs"),
  );
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts["check:deploy-freshness"], "node scripts/check-deploy-freshness.mjs");
});
