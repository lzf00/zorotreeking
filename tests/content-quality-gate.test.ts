/**
 * 内容质量检查的**分级**必须正确（第 202 轮）。
 *
 * 第 201 轮的教训：一个每天会变的指标卡住了发布闸门，线上停更两天。
 * 同类的两条检查（英文日报里的中文名、日报封面复用）也在 `npm test` 里 ——
 * 它们检查的是**外部生成端**的产出，生成端一抖就冻住整站，不划算。
 *
 * 现在的分工：
 *   本地 `npm run gate` → 硬失败（问题该先修再推）
 *   CI 的 deploy.yml     → `continue-on-error: true` 的告警（annotation + step summary）
 * 这个文件锁住分工本身，防止以后有人把它挪回 `npm test`、或者删掉 CI 里的告警。
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

test("本地门禁里是硬失败：gate 一定包含 check:content-quality", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.scripts["check:content-quality"] ?? "", /check-content-quality\.mjs/);
  assert.ok(pkg.scripts.gate.includes("npm run check:content-quality"), "gate 里要有它（发现问题先修，不推）");
});

test("这些内容状态断言不许留在 tests/ 里（会冻住发布）", async () => {
  const finance = await read("tests/finance-names.test.ts");
  assert.doesNotMatch(finance, /已发布的英文日报里/, "已发布内容扫描应在 check-content-quality.mjs");
  const covers = await read("tests/digest-covers.test.ts");
  assert.doesNotMatch(covers, /不能被超过 8%/, "封面复用比例应在 check-content-quality.mjs");
});
