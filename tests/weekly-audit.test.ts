/**
 * 每周巡检必须真的会跑（第 153 轮）。
 *
 * 背景：`site-audit.yml` / `a11y.yml` / `freshness-watch.yml` 都只靠 `schedule: cron`，
 * 而实测 cron 会整周不触发（第 145 轮）—— 这三个 workflow 从建立起就没跑过。
 * 现在改成"部署时判旧补跑"：本文件钉住四条不能退化的性质。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("判旧才跑：7 天内不重复劳动", async () => {
  const script = await read("scripts/weekly-audit.mjs");
  assert.match(script, /src["'],\s*"data",\s*"weekly-audit\.json"/, "戳记要在 src/data/weekly-audit.json");
  assert.match(script, /max-age-days/, "要能配有效期");
  assert.match(script, /还在有效期内/, "跳过要有可读的输出，不能静默");
});

test("巡检不挡发布：发现问题只写报告 + 注解", async () => {
  const script = await read("scripts/weekly-audit.mjs");
  // run() 把任何失败都收成数据；main 只有脚本自己崩了才返回非 0
  assert.match(script, /resolve\(\{[^}]*ok: code === 0/s, "检查失败要变成数据而不是异常");
  assert.match(script, /::warning title=每周巡检/, "有问题要发注解，否则没人知道");
  const deploy = await read(".github/workflows/deploy.yml");
  assert.match(deploy, /node scripts\/weekly-audit\.mjs --max-age-days=7/);
  assert.match(deploy, /每周巡检脚本自身出错/, "脚本崩了要单独说明，别和'检查有问题'混在一起");
});

test("没有 dist 时明确跳过外链，不许假绿", async () => {
  const script = await read("scripts/weekly-audit.mjs");
  // 外链体检从 dist 收集 URL：没有 dist 会「0 条链接、顺利通过」
  assert.match(script, /existsSync\(path\.join\(ROOT, "dist"\)\)/, "要判 dist 是否存在");
  assert.match(script, /跳过站外链接体检/, "跳过必须说出来");
});

test("巡检产物必须真的进仓库（reports/ 是 gitignore 的）", async () => {
  const deploy = await read(".github/workflows/deploy.yml");
  // 事故（第 153 轮）：`git add reports/` 因为路径被忽略整体失败 → 什么都没暂存 →
  // 下一步静默输出"没有新结果"。巡检跑了、戳记没进仓库，于是每次部署都会重跑。
  assert.match(deploy, /git add -f src\/data\/weekly-audit\.json/, "戳记必须 -f 提交");
  // 通配符没匹配到文件时 `git add` 整条失败（sh 不展开），所以必须先 ls 判断
  assert.match(deploy, /if ls reports\/weekly-audit-\*\.md/, "报告要先判断存在再 add");
  assert.match(deploy, /没有可提交的产物/, "没有产物时要报警，不能当成正常");
  const script = await read("scripts/weekly-audit.mjs");
  assert.match(script, /GITHUB_STEP_SUMMARY/, "报告要写进 step summary，提交失败也看得见结果");
});

test("外链体检分批跑，缓存进仓库（否则每次全量重抓十几分钟）", async () => {
  const script = await read("scripts/weekly-audit.mjs");
  assert.match(script, /--limit/, "要限量");
  assert.match(script, /--cache=src\/data\/external-links-cache\.json/, "缓存路径要提交进仓库");
  const links = await read("scripts/check-external-links.mjs");
  assert.match(links, /--cache=/, "脚本要支持自定义缓存路径");
  const cache = JSON.parse(await read("src/data/external-links-cache.json")) as Record<string, { at: number }>;
  assert.ok(Object.keys(cache).length > 1000, `缓存条目太少（${Object.keys(cache).length}），分批刷新会退化成全量`);
});

test("历史断档不该每周报同一个错", async () => {
  const script = await read("scripts/weekly-audit.mjs");
  assert.match(script, /check-freshness\.mjs", "--ignore-gaps"/, "要带 --ignore-gaps（11-19/11-20 抓不回来）");
});
