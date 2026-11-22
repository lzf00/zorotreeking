/**
 * 全站无障碍审计的排程与自动化体检的诚实性（第 180 轮）。
 *
 * 事实背景：第 179 轮的自动化体检第一次跑就报出 **`a11y.yml` 从来没有运行记录** ——
 * 它只有 cron，而本仓库 cron 会延迟 5–7 小时甚至整周不触发。于是一整套"全站 1190 页 ×
 * 浅/深两套"的 axe 审计形同不存在，无障碍只剩门禁里抽样 22 页的检查。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { decideDue } from "../scripts/a11y-due.mjs";
import { auditAutomation } from "../scripts/check-automation-health.mjs";

const read = (p: string) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const NOW = new Date("2026-11-23T00:00:00Z");

test("判旧：没戳记 → 要跑（宁多跑一次，不要静默跳过）", () => {
  assert.equal(decideDue(null, NOW, 7).due, true);
  assert.equal(decideDue("不是日期", NOW, 7).due, true);
  assert.match(decideDue(undefined, NOW, 7).reason, /没有审计戳记/);
});

test("判旧：7 天内不跑，超过就跑", () => {
  assert.equal(decideDue("2026-11-20T00:00:00Z", NOW, 7).due, false);
  const aged = decideDue("2026-11-10T00:00:00Z", NOW, 7);
  assert.equal(aged.due, true);
  assert.equal(Math.floor(aged.ageDays), 13);
});

test("自动化体检：读不到运行记录 ≠ 从来没跑过（第 172 轮的教训）", () => {
  const wf = [{ file: "a11y.yml", expectation: { kind: "cron", days: 7 } }];
  const { rows, problems, inconclusive } = auditAutomation(wf, {}, NOW, { unfetched: new Set(["a11y.yml"]) });
  assert.deepEqual(problems, [], "读不到时不许报「从来没有运行过」");
  assert.deepEqual(inconclusive, ["a11y.yml"]);
  assert.equal(rows[0].verdict, "unknown");
  assert.match(rows[0].why, /读不到运行记录/);
});

test("自动化体检：真的没跑过才是 problem", () => {
  const wf = [{ file: "site-audit.yml", expectation: { kind: "cron", days: 7 } }];
  const { problems } = auditAutomation(wf, {}, NOW, {});
  assert.equal(problems.length, 1);
  assert.match(problems[0], /从来没有运行过/);
});

test("a11y.yml 不再只有 cron：有 workflow_run 触发 + 判旧闸 + 戳记回写", async () => {
  const yml = await read(".github/workflows/a11y.yml");
  assert.match(yml, /workflow_run:\n\s+workflows: \["Build & Deploy"\]/);
  assert.match(yml, /node scripts\/a11y-due\.mjs --max-age-days=7/);
  assert.match(yml, /steps\.due\.outputs\.due == 'true'/, "贵步骤必须挂在判旧结果上");
  assert.match(yml, /src\/data\/a11y-audit\.json/, "戳记必须回写仓库，否则每次部署都重跑 20 分钟");
  assert.match(yml, /contents: write/);
});

test("戳记必须在所有检查之后才记（失败不能算「跑过了」）", async () => {
  const yml = await read(".github/workflows/a11y.yml");
  const stampAt = yml.indexOf("name: Record the audit stamp");
  for (const later of ["Spot-check phone width", "Island hydration smoke test"]) {
    assert.ok(yml.indexOf(later) > 0 && yml.indexOf(later) < stampAt, `${later} 必须在记戳记之前`);
  }
});

// ── 第 181 轮：戳记的两个坑 ──────────────────────────────────────────────
//
// 实测：第一次真跑（45060632868）axe 发现违规 → 步骤失败 → 戳记步骤被 `&& success()`
// 跳过 → 下次部署又判「该跑」。越是有问题越是天天重跑 20 分钟。
// 另一个坑：`git diff --quiet` 看不见**未跟踪**的新文件，第一次跑永远不提交。

test("戳记不看审计结果成败，只看审计有没有真的跑", async () => {
  const yml = await read(".github/workflows/a11y.yml");
  assert.match(yml, /- name: Record the audit stamp\n(?:.*\n)*?\s+if: steps\.due\.outputs\.due == 'true' && steps\.audit\.outcome != 'skipped'/);
  assert.doesNotMatch(yml, /name: Record the audit stamp\n(?:.*\n)*?\s+if: [^\n]*success\(\)/, "不许再用 success() 挡住戳记");
});

test("戳记用 git status 而不是 git diff（未跟踪文件 git diff 看不见）", async () => {
  const yml = await read(".github/workflows/a11y.yml");
  assert.match(yml, /git status --porcelain -- src\/data\/a11y-audit\.json/);
  assert.doesNotMatch(yml, /git diff --quiet src\/data\/a11y-audit\.json/);
});

test("axe 步骤有 id，戳记才能判断它跑没跑", async () => {
  const yml = await read(".github/workflows/a11y.yml");
  assert.match(yml, /name: Run axe over every page \(light \+ dark\)\n\s+id: audit/);
});

// ── 第 181 轮：全站审计的首个真实结论 ──────────────────────────────────
//
// 1190 页 × 浅/深 第一次真跑，唯一违规在 /invest/us-market/：hawkish 时卡片带
// bg-rose-500/[0.07] 着色，压在它上面的 --text-tertiary 灰只剩 ~3:1。
// 该页此前**不在** check:a11y:fast 的规则集里，所以门禁一直是绿的。

test("凡是被全站审计点名的页面，都必须进 check:a11y:fast 的规则集", async () => {
  const pkg = JSON.parse(await read("package.json"));
  const fast = pkg.scripts["check:a11y:fast"] as string;
  const ruleset = await read("scripts/check-a11y.mjs");
  assert.match(fast, /\/invest\/us-market\//, "被审计抓到的页面必须留在快速抽查里");
  assert.match(ruleset, /"\/invest\/us-market\/"/, "规则集本身也要有它，否则 --paths 会报未知路径");
});

test("着色卡片里的次要文字不能再用 tertiary（薄色底上对比度不够）", async () => {
  const tsx = await read("src/components/UsMarketDashboard.tsx");
  const combinedRead = tsx.slice(tsx.indexOf("Combined Read") - 400, tsx.indexOf("Combined Read") + 120);
  assert.match(combinedRead, /text-\[var\(--text-secondary\)\]/, "眼睛文案要用 secondary");
  assert.doesNotMatch(combinedRead, /text-\[var\(--text-tertiary\)\]/);
});

test("审计报告写文件不许重定向 stdout（否则 ::error 注解到不了 Actions 页）", async () => {
  const yml = await read(".github/workflows/a11y.yml");
  assert.doesNotMatch(yml, /a11y-audit\.mjs[^\n]*>\s*a11y-report\.json/, "stdout 被重定向时，违规注解会一起进文件");
  assert.match(yml, /--out=a11y-report\.json/);
});

test("审计脚本在 CI 里为每类违规打注解（不登录也能看出原因）", async () => {
  const script = await read("scripts/a11y-audit.mjs");
  assert.match(script, /GITHUB_ACTIONS/, "要判断是不是跑在 Actions 里");
  assert.match(script, /::error title=a11y/, "要输出 GitHub 注解");
  assert.match(script, /pages_list/, "注解里要带例页");
});
