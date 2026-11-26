/**
 * 内容质量检查的**分级**必须正确（第 202 轮）。
 *
 * 第 201 轮的教训：一个每天会变的指标卡住了发布闸门，线上停更两天。
 * 同类的两条检查（英文日报里的中文名、日报封面复用）也在 `npm test` 里 ——
 * 它们检查的是**外部生成端**的产出，生成端一抖就冻住整站，不划算。
 *
 * 现在的分工（第 227 轮修订）：
 *   本地 `npm run gate` → 跑，但 **不拦**（`--non-blocking`）
 *   CI 的 deploy.yml     → `continue-on-error: true` 的告警（annotation + step summary）
 * 第 227 轮之前本地是硬失败的。问题是：英文日报里的中文名由**服务器上的生成端**每天写回，
 * 本地拉下来就是脏的，于是三轮里三次把整条门禁卡红 —— 用内容问题挡住代码发布，
 * 与「门禁只该被代码挡住」这条原则相反。现在两边一致：检查照跑、注解照发、不拦发布。
 * 这个文件锁住分工本身，防止以后有人把它挪回 `npm test`、改成硬失败、或者删掉 CI 里的告警。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { COVER_POOL_MIN, COVER_SHARE_LIMIT, coverReuse, judgeCovers, leftoverNames } from "../scripts/check-content-quality.mjs";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

test("leftoverNames：只认整格等于已知名的单元格", () => {
  const known = new Set(["酿酒行业", "北方华创"]);
  const lines = [
    "| 板块 | 涨幅 |",
    "| 酿酒行业 | +3.2% |",
    "| 北方华创 | 🟢 +1.1% |",
    "| 白酒与酿酒行业相关的公司 | +2% |",
    "| `酿酒行业` | 代码块里的不算 |",
  ];
  assert.deepEqual(leftoverNames(lines, known), ["酿酒行业", "北方华创"], "整格匹配；带 emoji 也算；长句与代码块不算");
  assert.deepEqual(leftoverNames(["普通段落：酿酒行业"], known), [], "非表格行不看");
});

test("coverReuse：数封面份额，最挤的那张排第一", () => {
  const digests = [
    { cover: "a.jpg" }, { cover: "a.jpg" }, { cover: "a.jpg" },
    { cover: "b.jpg" }, { cover: "c.jpg" },
    { cover: null },
  ];
  const reuse = coverReuse(digests);
  assert.equal(reuse.total, 6);
  assert.equal(reuse.distinct, 3);
  assert.deepEqual(reuse.worst, { cover: "a.jpg", count: 3, share: 0.5 });
});

test("judgeCovers：超阈值/池子太小/扫不到内容都要判不合格", () => {
  assert.equal(judgeCovers({ total: 100, distinct: 40, worst: { cover: "x", count: 9, share: 0.09 } }).ok, false, "9% 超 8%");
  assert.equal(judgeCovers({ total: 100, distinct: 40, worst: { cover: "x", count: 8, share: 0.08 } }).ok, true, "正好 8% 合规");
  assert.equal(judgeCovers({ total: 0, distinct: 0, worst: null }).ok, false, "0 篇 = 检查失效");
  assert.equal(
    judgeCovers({ total: 100, distinct: COVER_POOL_MIN - 1, worst: { cover: "x", count: 1, share: 0.01 } }).ok,
    false,
    "封面池低于下限也算不合格",
  );
  assert.ok(COVER_SHARE_LIMIT > 0 && COVER_SHARE_LIMIT < 1);
});

test("CI 里只告警：deploy.yml 的这一步 continue-on-error 且写注解与 step summary", async () => {
  const source = await read(".github/workflows/deploy.yml");
  const start = source.indexOf("- name: Content quality (warn only)");
  assert.ok(start > 0, "deploy.yml 里必须有内容质量步骤");
  const block = source.slice(start, source.indexOf("- name: Unit and guard tests", start));
  assert.match(block, /continue-on-error: true/, "不许拦发布");
  assert.match(block, /GITHUB_STEP_SUMMARY/, "要把明细留在 run 页");
  assert.match(block, /::warning title=内容质量::/, "要发注解");
  assert.match(block, /exit 0/, "永远不许让这一步变红");
});

test("本地门禁里跑内容质量检查，但不让它拦发布（第 227 轮改的口径）", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.scripts["check:content-quality"] ?? "", /check-content-quality\.mjs/);
  assert.match(
    pkg.scripts.gate,
    /npm run check:content-quality -- --non-blocking/,
    "gate 里要跑它，但必须带 --non-blocking（内容问题不拦发布）",
  );

  // 同一条口径也要覆盖 i18n 泄漏检查：它同样是「服务器生成端每天写回的脏数据」，
  // 不能拿它挡住代码发布。
  assert.match(pkg.scripts.gate, /npm run check:i18n-leaks -- --non-blocking/, "i18n 泄漏检查也要非阻塞");
  const leaks = await read("scripts/check-i18n-leaks.mjs");
  assert.match(leaks, /const nonBlocking = args\.includes\("--non-blocking"\)/, "i18n 检查要解析这个开关");
  assert.ok((leaks.match(/if \(nonBlocking\)/g) ?? []).length >= 2, "正文泄漏与界面属性两处退出都要受开关控制");

  // 脚本本身要真的尊重这个开关：带 flag 时退出码恒为 0，不带时仍按失败数返回
  const script = await read("scripts/check-content-quality.mjs");
  assert.match(script, /const nonBlocking = args\.includes\("--non-blocking"\)/, "要解析这个开关");
  assert.match(script, /if \(nonBlocking\) return 0;/, "开关生效后不许再把退出码设成 1");
});
test("这些内容状态断言不许留在 tests/ 里（会冻住发布）", async () => {
  const finance = await read("tests/finance-names.test.ts");
  assert.doesNotMatch(finance, /已发布的英文日报里/, "已发布内容扫描应在 check-content-quality.mjs");
  const covers = await read("tests/digest-covers.test.ts");
  assert.doesNotMatch(covers, /不能被超过 8%/, "封面复用比例应在 check-content-quality.mjs");
});

test("英文日报有中文名时，报错要直接给出可执行的修法（第 218 轮）", async () => {
  const { readFile } = await import("node:fs/promises");
  const script = await readFile(new URL("../scripts/check-content-quality.mjs", import.meta.url), "utf8");
  assert.match(script, /npm run fix:recap-names/, "报错里要写清怎么修");

  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.scripts["fix:recap-names"], "npm 脚本要真的存在，否则报错里那句是空话");
  assert.match(pkg.scripts["fix:recap-names"], /backfill_en_names\.py/);
  assert.match(pkg.scripts["fix:recap-names"], /--headlines/, "要连要闻段一起修");
  // 部署里已经会在测试前跑同一条命令；这里保证"人看到的修法"和"CI 的修法"是同一个
  const deploy = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(deploy, /python3 scripts\/wind\/backfill_en_names\.py --headlines/);
});
