/**
 * 内容新鲜度看门狗（scripts/check-freshness.mjs）。
 *
 * 起因：AI 日报自 2026-11-18 起静默停更 3 天，站点照常构建、门禁全绿、巡检 0 失败 ——
 * 「没产出」不是错误，所以没有任何地方会红。这个脚本把「产出节奏」变成可断言的。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { beijingToday, bilingualGaps, formatFreshness, STREAMS, summarizeFreshness } from "../scripts/check-freshness.mjs";

const PKG = new URL("../package.json", import.meta.url);
const DIGEST_WF = new URL("../.github/workflows/daily-digest.yml", import.meta.url);
const AUDIT_WF = new URL("../.github/workflows/site-audit.yml", import.meta.url);

const aiFiles = (...dates) => dates.flatMap((date) => [`digest-${date}.zh.mdx`, `digest-${date}.en.mdx`]);
const investFiles = (...dates) => dates.flatMap((date) => [`market-recap-${date}.zh.mdx`, `market-recap-${date}.en.mdx`]);
// 投资目录里有两种每日内容：资讯日报 digest-*、复盘 market-recap-*（第 115 轮才发现日报没被盯）
const investDigestFiles = (...dates) => dates.flatMap((date) => [`digest-${date}.zh.mdx`, `digest-${date}.en.mdx`]);
const allGood = (ai = ["2026-11-21"], invest = ["2026-11-21"]) => ({
  "ai-digest": aiFiles(...ai),
  "invest-digest": investDigestFiles(...invest),
  "invest-recap": investFiles(...invest),
});

test("北京时间按 UTC+8 算，跨零点不会算错一天", () => {
  // UTC 2026-11-20 16:30 = 北京 2026-11-21 00:30
  assert.equal(beijingToday(new Date("2026-11-20T16:30:00Z")), "2026-11-21");
  assert.equal(beijingToday(new Date("2026-11-20T15:59:00Z")), "2026-11-20");
});

test("三条流水线都按时更新：通过", () => {
  const result = summarizeFreshness(
    {
      "ai-digest": aiFiles("2026-11-19", "2026-11-20", "2026-11-21"),
      "invest-digest": investDigestFiles("2026-11-20", "2026-11-21"),
      "invest-recap": investFiles("2026-11-20", "2026-11-21"),
    },
    { today: "2026-11-21" },
  );
  assert.equal(result.ok, true, result.failing.map((r) => r.reason).join("；"));
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].age, 0);
  assert.equal(result.rows[0].count, 6, "篇数要能统计（中英各一篇算两篇）");
});

test("投资日报停更要被发现（第 115 轮前的盲区：只盯了周报/复盘）", () => {
  const result = summarizeFreshness(
    {
      "ai-digest": aiFiles("2026-11-21"),
      "invest-digest": investDigestFiles("2026-11-16"), // 日报停了 5 天
      "invest-recap": investFiles("2026-11-21"),        // 复盘正常
    },
    { today: "2026-11-21", maxAgeDays: 2 },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.failing.map((row) => row.id), ["invest-digest"]);
  assert.match(result.failing[0].reason, /5 天没有更新/);
});

test("单语日同样算失败：中文有、英文没翻出来，站内会出现死链", () => {
  const result = summarizeFreshness(
    {
      "ai-digest": ["digest-2026-11-21.zh.mdx", "digest-2026-11-20.zh.mdx", "digest-2026-11-20.en.mdx"],
      "invest-digest": investDigestFiles("2026-11-21"),
      "invest-recap": investFiles("2026-11-21"),
    },
    { today: "2026-11-21", maxAgeDays: 2 },
  );
  assert.equal(result.ok, false, "日期新鲜但缺英文，必须拦下来");
  assert.deepEqual(result.gaps, [{ stream: "ai-digest", label: "AI 日报", date: "2026-11-21", missing: ["en"] }]);
  assert.match(formatFreshness(result), /缺 en/);
});

test("bilingualGaps：窗口外的历史单语日不追究", () => {
  const gaps = bilingualGaps(
    { "ai-digest": ["digest-2026-11-01.zh.mdx", "digest-2026-11-21.zh.mdx", "digest-2026-11-21.en.mdx"] },
    { today: "2026-11-21", days: 3 },
  );
  assert.deepEqual(gaps, [], "11-01 已经超出 3 天窗口");
});

test("线上真实故障形态：AI 日报落后 3 天要 fail，投资复盘只落后 1 天算 ok", () => {
  const result = summarizeFreshness(
    {
      "ai-digest": aiFiles("2026-11-16", "2026-11-17", "2026-11-18"),
      "invest-digest": investDigestFiles("2026-11-19", "2026-11-20"),
      "invest-recap": investFiles("2026-11-19", "2026-11-20"),
    },
    { today: "2026-11-21", maxAgeDays: 2 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.failing.length, 1);
  assert.equal(result.failing[0].id, "ai-digest");
  assert.match(result.failing[0].reason, /3 天没有更新/);
  assert.match(formatFreshness(result), /❌/, "表格里要能一眼看出哪条停了");
});

test("只落后一天算 warn 不算 fail（单天抖动不该把 job 打红）", () => {
  const result = summarizeFreshness(
    { "ai-digest": aiFiles("2026-11-19"), "invest-digest": investDigestFiles("2026-11-20"), "invest-recap": investFiles("2026-11-20") },
    { today: "2026-11-21", maxAgeDays: 2 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].level, "warn");
});

test("--require-today：流水线收尾时今天必须有产出", () => {
  const yesterdayOnly = summarizeFreshness(
    { "ai-digest": aiFiles("2026-11-20"), "invest-digest": investDigestFiles("2026-11-20"), "invest-recap": investFiles("2026-11-20") },
    { today: "2026-11-21", requireToday: true },
  );
  assert.equal(yesterdayOnly.ok, false);
  assert.equal(yesterdayOnly.failing.length, 3);
  assert.match(yesterdayOnly.failing[0].reason, /今天（2026-11-21）没有产出/);
});

test("空目录 / 文件名不合规都不会崩，而是报「一篇都没有」", () => {
  const result = summarizeFreshness({ "ai-digest": ["README.md", "digest-bad-date.mdx"], "invest-digest": [], "invest-recap": [] }, { today: "2026-11-21" });
  assert.equal(result.ok, false);
  for (const row of result.rows) {
    assert.equal(row.newest, null);
    assert.match(row.reason, /一篇都没有/);
  }
});

test("日期比较按字典序也要对：跨月/跨年", () => {
  const crossYear = summarizeFreshness(
    { "ai-digest": aiFiles("2025-12-31"), "invest-digest": investDigestFiles("2026-01-01"), "invest-recap": investFiles("2026-01-01") },
    { today: "2026-01-02", maxAgeDays: 2 },
  );
  assert.equal(crossYear.rows[0].newest, "2025-12-31");
  assert.equal(crossYear.rows[0].age, 2);
  assert.equal(crossYear.rows[1].age, 1);
  assert.equal(crossYear.rows[2].age, 1);
});

test("流水线定义本身：正则只认自己的文件名，不把 weekly/其他集合算进来", () => {
  const digest = STREAMS.find((stream) => stream.id === "ai-digest");
  assert.ok(digest.pattern.test("digest-2026-11-18.zh.mdx"));
  assert.ok(!digest.pattern.test("weekly-2026-W46.zh.mdx"), "周报不算日报");
  assert.ok(!digest.pattern.test("hello-world.zh.mdx"));
  const invest = STREAMS.find((stream) => stream.id === "invest-recap");
  assert.ok(invest.pattern.test("market-recap-2026-11-20.en.mdx"));
  const investDigest = STREAMS.find((stream) => stream.id === "invest-digest");
  assert.ok(investDigest, "投资日报必须有自己的流水线定义，否则停更永远发现不了");
  assert.ok(investDigest.pattern.test("digest-2026-11-21.zh.mdx"));
  assert.ok(!investDigest.pattern.test("market-recap-2026-11-21.zh.mdx"), "复盘不算日报");
});

test("接线：npm 脚本、日报收尾断言、每周巡检都到位", async () => {
  const pkg = JSON.parse(await readFile(PKG, "utf8"));
  assert.equal(pkg.scripts["check:freshness"], "node scripts/check-freshness.mjs");

  const digest = await readFile(DIGEST_WF, "utf8");
  assert.match(digest, /node scripts\/check-freshness\.mjs --require-today --max-age=1/);
  assert.match(digest, /if: always\(\)/, "前一步失败也要跑断言");
  assert.match(digest, /GITHUB_STEP_SUMMARY/);

  const audit = await readFile(AUDIT_WF, "utf8");
  assert.match(audit, /node scripts\/check-freshness\.mjs/);
});
