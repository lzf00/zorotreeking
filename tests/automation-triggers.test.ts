/**
 * 周期性 workflow 必须有一个「真的会响」的触发源（第 182 轮）。
 *
 * 事故链：`a11y.yml` 和 `site-audit.yml` 都只写了 `schedule`，而这个仓库的 cron 实测会延迟
 * 5–7.5 小时、甚至整周不触发 —— 于是「每周全站巡检」写了四个月，**一行都没执行过**
 * （第 179 轮自动化体检发现）。a11y 改成「部署后醒一次 + 戳记判到期」之后，第一次真跑
 * 就抓到一处真实对比度违规（第 181 轮）。
 *
 * 这条守卫把「别再写出只靠 cron 的 workflow」变成可以本地执行的规则：
 * 要么有可靠触发源，要么在 allowlist 里写清备份路径。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { explainCategoryFailure } from "../scripts/lhci-annotate.mjs";
import { test } from "node:test";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WORKFLOWS = path.join(ROOT, ".github", "workflows");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** 极简触发源提取：只关心 on: 下面第一层的键。 */
function triggersOf(source: string): string[] {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => /^on:/.test(line));
  assert.ok(start >= 0, "workflow 必须有 on:");
  const triggers: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim()) break; // 回到顶层键
    const m = /^ {2}([a-zA-Z_]+):/.exec(line);
    if (m) triggers.push(m[1]);
  }
  return triggers;
}

const ALLOWLIST = JSON.parse(read("scripts/cron-only-allowlist.json")) as Record<string, string>;

test("只靠 cron 的 workflow 必须登记备份路径", () => {
  const offenders: string[] = [];
  for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    const triggers = triggersOf(readFileSync(path.join(WORKFLOWS, file), "utf8"));
    if (!triggers.includes("schedule")) continue;
    const reliable = triggers.filter((t) => !["schedule", "workflow_dispatch"].includes(t));
    if (reliable.length > 0) continue;
    if (!ALLOWLIST[file]) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `这些 workflow 只靠 cron，而这个仓库的 cron 不可靠；请加 workflow_run 触发或登记到 scripts/cron-only-allowlist.json：${offenders.join(", ")}`);
});

test("allowlist 里每条都写了理由，且没有过期条目", () => {
  const bare = Object.entries(ALLOWLIST)
    .filter(([key, reason]) => !key.startsWith("_") && (!reason || reason.trim().length < 20))
    .map(([key]) => key);
  assert.deepEqual(bare, [], `这些登记没写清兜底路径：${bare.join(", ")}`);
  const stale = Object.keys(ALLOWLIST)
    .filter((key) => !key.startsWith("_"))
    .filter((key) => {
      const file = path.join(WORKFLOWS, key);
      if (!existsSync(file)) return true;
      const triggers = triggersOf(readFileSync(file, "utf8"));
      return triggers.some((t) => !["schedule", "workflow_dispatch"].includes(t));
    });
  assert.deepEqual(stale, [], `这些条目已经不再只靠 cron（或文件已删），登记该删掉：${stale.join(", ")}`);
});

test("三个周审计都是「部署后醒一次 + 戳记判到期」", () => {
  const cases: Array<[string, string]> = [
    ["a11y.yml", "src/data/a11y-audit.json"],
    ["site-audit.yml", "src/data/site-audit.json"],
    ["lighthouse-mobile.yml", "src/data/lighthouse-mobile.json"],
  ];
  for (const [file, stamp] of cases) {
    const source = read(`.github/workflows/${file}`);
    assert.match(source, /workflow_run:/, `${file} 缺 workflow_run 触发`);
    assert.match(source, /workflows: \["Build & Deploy"\]/, `${file} 的上游不是 Build & Deploy`);
    assert.match(source, /scripts\/audit-due\.mjs/, `${file} 没用到期判定`);
    assert.ok(source.includes(stamp), `${file} 的到期判定没指向 ${stamp}`);
    assert.match(source, /record-audit-stamp\.mjs/, `${file} 跑完不记戳记 → 每次部署都会重跑`);
    assert.match(source, /contents: write/, `${file} 要提交戳记，权限里必须有 contents: write`);
  }
});

test("到期判定能按 --stamp= 指向不同戳记", () => {
  // 注意：不能拿真实戳记文件当输入 —— 它会被 bot 提交，测试会随 CI 运行时间时绿时红
  // （第 182 轮踩过：本地断言"还不存在所以该跑"，bot 提交后变成"存在所以不该跑"）。
  const tmp = path.join(os.tmpdir(), `audit-due-${process.pid}.json`);
  const run = (ranAt: string | null) => {
    if (ranAt === null) rmSync(tmp, { force: true });
    else writeFileSync(tmp, JSON.stringify({ ranAt }));
    return JSON.parse(
      execFileSync(process.execPath, [path.join(ROOT, "scripts", "audit-due.mjs"), `--stamp=${tmp}`, "--json"], { encoding: "utf8" }),
    ) as { due: boolean; stamp: string; ageDays: number | null };
  };

  const missing = run(null);
  assert.equal(missing.due, true, "没有戳记时必须跑");
  // 输出里的 stamp 是相对仓库根的路径（绝对路径会被写成 ../../..），只校验文件名
  assert.equal(path.basename(missing.stamp), path.basename(tmp), "--stamp= 要生效");

  const old = run(new Date(Date.now() - 30 * 86_400_000).toISOString());
  assert.equal(old.due, true, "30 天前的戳记必须重跑");
  assert.ok(old.ageDays !== null && old.ageDays > 29);

  const fresh = run(new Date().toISOString());
  assert.equal(fresh.due, false, "刚跑过就不该再跑");
  rmSync(tmp, { force: true });
});

test("戳记脚本 --dry-run 不写盘（181 轮被它覆盖过真实戳记）", () => {
  const before = read("src/data/a11y-audit.json");
  execFileSync(
    process.execPath,
    [path.join(ROOT, "scripts", "record-audit-stamp.mjs"), "--stamp=src/data/a11y-audit.json", "--dry-run"],
    { encoding: "utf8" },
  );
  assert.equal(read("src/data/a11y-audit.json"), before, "dry-run 不许改文件");
});

test("Lighthouse 断言失败要能被公开看见（注解），且注解排在跑分之后", () => {
  const source = read(".github/workflows/lighthouse-mobile.yml");
  const lhci = source.indexOf("name: Run Lighthouse CI (mobile preset)");
  const annotate = source.indexOf("lhci-annotate.mjs");
  assert.ok(lhci > 0 && annotate > lhci, "注解步骤必须在跑分之后");
  assert.match(source, /if: always\(\)/, "跑分失败时也要执行注解步骤");
});

test("入场动画不动透明度（否则审计把半透明的字判成对比度违规）", () => {
  const config = read("tailwind.config.mjs");
  const rise = /rise: \{([\s\S]*?)\}/.exec(config)?.[1] ?? "";
  assert.ok(rise.length > 0, "找不到 rise keyframes");
  assert.doesNotMatch(rise, /opacity/, "rise 动画里出现 opacity：首屏文字会短暂半透明，自动化审计必然误判");
});

test("类目断言失败能下钻到具体审计（否则只有一句「seo 0.93」等于没说）", () => {
  const url = "https://www.zorotreeking.online/x/";
  const makeLhr = (failing: string[]) => ({
    finalUrl: url,
    categories: { seo: { auditRefs: ["document-title", "robots-txt", "hreflang"].map((id) => ({ id, weight: 1 })) } },
    audits: {
      "document-title": { score: 1, title: "title" },
      "robots-txt": { score: failing.includes("robots-txt") ? 0 : 1, title: "robots" },
      hreflang: { score: failing.includes("hreflang") ? 0 : 1, title: "hreflang", details: { items: [{ node: { snippet: "<link hreflang=x>" } }] } },
    },
  });
  const causes = explainCategoryFailure([makeLhr(["robots-txt"]), makeLhr(["robots-txt"]), makeLhr(["hreflang"])], "seo");
  assert.equal(causes.length, 2);
  assert.equal(causes[0].id, "robots-txt", "失败次数多的排前面");
  assert.equal(causes[0].failed, 2);
  assert.equal(causes[0].runs, 3);
  assert.equal(causes[0].always, false, "2/3 次是抖动，不是稳定失败");
  assert.equal(causes[1].id, "hreflang");
  assert.equal(causes[1].sample, "<link hreflang=x>");
});

test("注解脚本会读同目录的 LHR 文件做下钻", () => {
  const source = read("scripts/lhci-annotate.mjs");
  assert.match(source, /lhr-.*\.json|\^lhr-/, "要扫描 .lighthouseci/lhr-*.json");
  assert.match(source, /categories:/, "要区分类目级断言");
});
