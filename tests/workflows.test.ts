import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = async (name: string) =>
  readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");

test("all workflows use the Node version required by Astro 7", async () => {
  const names = [
    "bulk-backfill.yml",
    "daily-digest.yml",
    "deadlink-check.yml",
    "deploy.yml",
    "lighthouse.yml",
    "weekly-roundup.yml",
  ];
  const files = await Promise.all(names.map(workflow));
  for (const contents of files) {
    assert.doesNotMatch(contents, /node-version:\s*["']?20/);
  }
});

test("Lighthouse budget failures are not swallowed", async () => {
  assert.doesNotMatch(await workflow("lighthouse.yml"), /lhci autorun\s*\|\|\s*true/);
});

test("Lighthouse skips generated market snapshots but audits user-facing changes", () => {
  const decide = (paths: string[]) => {
    const result = spawnSync(process.execPath, ["scripts/lighthouse-scope.mjs"], {
      cwd: new URL("..", import.meta.url),
      input: `${paths.join("\n")}\n`,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  assert.equal(decide([
    "src/data/etf-three-factor-early-latest.json",
    "src/data/etf-three-factor-status.json",
  ]), "skip");
  // 纯内容提交跳过：自动化日报每十几分钟提一次，跑满 35–40 分钟会互相取消
  assert.equal(decide(["src/content/ai/digest-2026-08-07.zh.mdx"]), "skip");
  assert.equal(decide([
    "src/content/invest/market-recap-2026-11-18.zh.mdx",
    "src/data/wind-hk-market-latest.json",
  ]), "skip");
  // 内容 + 模板混在一起时必须跑
  assert.equal(decide(["src/content/ai/digest-2026-08-07.zh.mdx", "src/layouts/BaseLayout.astro"]), "run");
  assert.equal(decide(["src/pages/explore.astro"]), "run");
  assert.equal(decide(["src/styles/global.css"]), "run");
  assert.equal(decide([".lighthouserc.json"]), "run");
  assert.equal(decide([]), "run");
});

test("Lighthouse workflow checks the deployed revision and keeps hidden reports", async () => {
  const contents = await workflow("lighthouse.yml");
  assert.match(contents, /statuses:\s*write/);
  assert.match(contents, /github\.event\.workflow_run\.head_sha/);
  assert.match(contents, /scripts\/lighthouse-scope\.mjs/);
  assert.match(contents, /LHCI_UPLOAD__GITHUB_TOKEN/);
  assert.match(contents, /include-hidden-files:\s*true/);
  // 逐 URL 中位分数要能被读出来：日志会截断、产物会过期，脚本本身不能没接上
  assert.match(contents, /scripts\/lighthouse-summary\.mjs/);
  assert.match(contents, /lighthouse-summary\.md/);
  // 每日定时兜底：内容提交跳过 workflow_run 之后，还得有固定的一次完整审计
  assert.match(contents, /schedule:/);
  assert.match(contents, /cron:\s*"0 19 \* \* \*"/);
  // 合并提交的 diff 必须带 --first-parent，否则自动化提交会被判成"没有改动"
  assert.match(contents, /diff-tree -r -m --first-parent/);
  // 取消会发生在 scope 判断之前，所以不能开 cancel-in-progress
  assert.match(contents, /cancel-in-progress:\s*false/);
  assert.doesNotMatch(contents, /cancel-in-progress:\s*true/);
});

test("deploy keeps the Giscus stylesheet inside the production CSP", async () => {
  const contents = await workflow("deploy.yml");
  assert.match(contents, /allow\("style-src", \["https:\/\/giscus\.app"\]/);
  assert.match(contents, /Giscus stylesheet origin missing from style-src/);
});

test("daily deployment includes follow-up translation and embedding commits", async () => {
  const contents = await workflow("daily-digest.yml");
  assert.match(contents, /steps\.commit_followups\.outputs\.committed/);
  assert.match(contents, /id:\s*commit_followups/);
});

test("automated content workflows fail when all push retries fail", async () => {
  for (const name of ["daily-digest.yml", "weekly-roundup.yml"]) {
    const contents = await workflow(name);
    assert.match(contents, /if \[ "\$PUSHED" != "1" \]/);
    assert.match(contents, /exit 1/);
  }
});

test("deploy workflow never prints private key material", async () => {
  const contents = await workflow("deploy.yml");
  assert.doesNotMatch(contents, /head\s+-c\s+\d+\s+~\/\.ssh\/deploy_key/);
  assert.match(contents, /ssh-keygen -y -f ~\/\.ssh\/deploy_key >\/dev\/null/);
});

test("deploy uses versioned releases, commit identity smoke, and automatic rollback", async () => {
  const contents = await workflow("deploy.yml");
  assert.match(contents, /releases\/\$GITHUB_SHA/);
  assert.match(contents, /cp -al "\$current"\/\. "\$target"\//);
  assert.match(contents, /rsync -az --checksum --stats --delete --no-perms --no-owner --no-group/);
  assert.match(contents, /dist\/deploy-meta\.json/);
  assert.match(contents, /meta\.get\("sha"\) != os\.environ\["GITHUB_SHA"\]/);
  assert.match(contents, /Roll back failed release/);
  assert.match(contents, /steps\.activate\.outcome == 'success'/);
  assert.match(contents, /readlink -f "\$release_root\/previous"/);
});

test("性能审计只量已切到目标提交的生产，且事后复核没被换版本", async () => {
  const lighthouse = await workflow("lighthouse.yml");
  // 部署的 rsync + 原子切换要几分钟；早于它开跑会量到新旧混着的页面
  // 排队中的审计常被更新的部署顶过去，所以等的是「生产有稳定版本」而不是死等目标提交
  assert.match(lighthouse, /Wait for production to settle/);
  assert.match(lighthouse, /deploy-meta\.json/);
  assert.match(lighthouse, /audited-sha/);
  assert.match(lighthouse, /production changed during the audit/);
  // 审计结果必须挂到「真正被审的那一版」上：workflow_run 的 GITHUB_SHA 会错位
  assert.match(lighthouse, /LHCI_BUILD_CONTEXT__CURRENT_HASH/);
  // 带连字符的 output 必须用中括号取值，点号取值在 GitHub 表达式里是空
  assert.match(lighthouse, /steps\.prodwait\.outputs\['audited-sha'\]/);
  assert.doesNotMatch(lighthouse, /steps\.prodwait\.outputs\.audited-sha/);
  // 「审了哪一版」发成公开 commit status，别只留在日志里
  assert.match(lighthouse, /perf\/audited/);
  // audited-sha.txt 里只能是一个裸 sha：曾经写成 `audited-sha=<sha>`，被当成提交号发 status → 404 静默失败
  assert.match(lighthouse, /echo "\$live" > audited-sha\.txt/);
  assert.doesNotMatch(lighthouse, /echo "audited-sha=\$live" > audited-sha\.txt/);
  assert.match(lighthouse, /sed 's\/\^audited-sha=/);
  // 发不出去要留痕，不能被 || true 吞掉
  assert.match(lighthouse, /::warning::perf\/audited/);
});

test("pre-push 钩子按改动范围分档，且内容提交不必跑整轮构建", async () => {
  const { prepushScope } = await import("../scripts/prepush-scope.mjs");
  assert.equal(prepushScope(["src/content/ai/daily-x.en.mdx"]), "fast");
  assert.equal(prepushScope(["src/data/wind-market-latest.json"]), "fast");
  assert.equal(prepushScope(["src/components/Navbar.astro"]), "full");
  assert.equal(prepushScope([".github/workflows/deploy.yml"]), "full");
  // 拿不到 diff 时按最重的处理，宁可慢一次
  assert.equal(prepushScope([]), "full");
});

test("pre-push 钩子会跑真正会失败的那两道内容门禁", async () => {
  const fs = await import("node:fs/promises");
  const hook = await fs.readFile(new URL("../.githooks/pre-push", import.meta.url), "utf8");
  assert.match(hook, /npm test/);
  assert.match(hook, /check:og/);
  assert.match(hook, /check:seo/);
  assert.match(hook, /SKIP_PREPUSH/);
});

test("审计前先烘一遍行情接口，且不为此额外加定时任务", async () => {
  const lighthouse = await workflow("lighthouse.yml");
  assert.match(lighthouse, /Warm the market endpoints/);
  assert.match(lighthouse, /\/api\/market\/\$\{endpoint\}/);
  // 实测 /api/market/sentiment 的缓存 TTL 只有约 60 秒：定时烘热没意义（烧 144 个 job/天 也烘不热），
  // 只在审计前烘一次让 15 个 URL 起点一致
  const fs = await import("node:fs/promises");
  const exists = await fs.stat(new URL("../.github/workflows/warm-api.yml", import.meta.url)).then(() => true).catch(() => false);
  assert.equal(exists, false, "TTL 太短，定时烘热任务已被移除；别再加回来");
});

test("周检除了全站浅/深两套，还抽 60 页手机宽度", async () => {
  const { readFile } = await import("node:fs/promises");
  const workflow = await readFile(new URL("../.github/workflows/a11y.yml", import.meta.url), "utf8");
  // 全量：浅 + 深
  assert.match(workflow, /a11y-audit\.mjs --all --scheme both/);
  // 手机视口抽查：窄屏换行/折叠后的问题宽屏看不见
  assert.match(workflow, /--pages 60 --scheme both --viewport 390x844/);
  // 两套 + 手机抽查，45 分钟不够，已提到 60
  assert.match(workflow, /timeout-minutes: 60/);
});

test("审计状态语义：开跑前是 pending 的 audit-target，跑完才发 audited", async () => {
  const contents = await workflow("lighthouse.yml");
  // 开跑前那条只能是 pending + audit-target：以前它在审计开始前就发 perf/audited success，
  // 分数还没出来状态栏就说「已审计」，属于假绿。
  assert.match(contents, /context\\":\\"perf\/audit-target\\",\\"state\\":\\"pending/);
  assert.doesNotMatch(contents, /context\\":\\"perf\/audited\\",\\"state\\":\\"success\\",\\"description\\":\\"audited \$\{target/);
  // 跑完之后那条要带最低/中位分，并且按 LHCI 的结论决定 success/failure
  assert.match(contents, /Mark the audited build/);
  assert.match(contents, /--audited-description/);
  assert.match(contents, /LHCI_OUTCOME/);
  // 顺序：Run Lighthouse CI → Summarize → 逐 URL 状态 → audited 标记
  const runIndex = contents.indexOf("- name: Run Lighthouse CI");
  const auditedIndex = contents.indexOf("- name: Mark the audited build");
  assert.ok(runIndex >= 0 && auditedIndex > runIndex, "perf/audited 必须发在审计之后");
});
