/**
 * 依赖公告体检（scripts/check-deps.mjs）的判定逻辑测试。
 *
 * 核心是「双向校验」：没评估过的公告要红，已经消失的白名单条目也要红。
 * 只测纯函数，不联网（真 npm audit 每周跑在巡检里）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { advisoryKey, evaluateAudit, formatReport, validateAllowlist } from "../scripts/check-deps.mjs";

const ALLOWLIST_FILE = new URL("../scripts/dependency-advisories.json", import.meta.url);
const PKG = new URL("../package.json", import.meta.url);
const WORKFLOW = new URL("../.github/workflows/site-audit.yml", import.meta.url);

/** 抄一份 npm audit --json 的真实结构（只保留用到的字段）。 */
const auditWith = (vulnerabilities) => ({ vulnerabilities, metadata: { vulnerabilities: { total: Object.keys(vulnerabilities).length } } });

const astroVuln = {
  astro: {
    severity: "moderate",
    via: [
      {
        source: 1,
        name: "astro",
        title: "Astro: XSS via attribute injection in dynamic tag names",
        url: "https://github.com/advisories/GHSA-mh32-jxcr-mh9f",
        severity: "low",
      },
      {
        source: 2,
        name: "astro",
        title: "Astro: Image endpoint in @astrojs/node …",
        url: "https://github.com/advisories/GHSA-r3h5-4585-7x3w",
        severity: "moderate",
      },
    ],
  },
};

const allowlist = {
  advisories: [
    { id: "GHSA-mh32-jxcr-mh9f", package: "astro", reason: "本站静态输出，攻击面不存在", revisit: "引入动态标签名时重评" },
    { id: "GHSA-r3h5-4585-7x3w", package: "astro", reason: "本站不用 @astrojs/node 适配器", revisit: "改 SSR 时重评" },
  ],
};

test("advisoryKey 优先取 GHSA，其次 CVE，最后标题", () => {
  assert.equal(advisoryKey(astroVuln.astro.via[0]), "GHSA-MH32-JXCR-MH9F");
  assert.equal(advisoryKey({ title: "x", url: "https://nvd.nist.gov/CVE-2026-1234" }), "CVE-2026-1234");
  assert.equal(advisoryKey("some-package"), "some-package");
});

test("全部评估过：通过，且大小写不影响匹配（npm 返回大写 GHSA）", () => {
  const result = evaluateAudit(auditWith(astroVuln), allowlist);
  assert.equal(result.unlisted.length, 0);
  assert.equal(result.stale.length, 0);
  assert.equal(result.accepted.length, 2);
  assert.equal(result.ok, true);
  assert.match(result.accepted[0].reason, /静态输出/, "要把 reason 一起带出来给报告用");
});

test("冒出一条没评估过的公告：必须失败", () => {
  const withNew = structuredClone(astroVuln);
  withNew.astro.via.push({
    name: "astro",
    title: "Astro: 新的公告",
    url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
    severity: "high",
  });
  const result = evaluateAudit(auditWith(withNew), allowlist);
  assert.equal(result.ok, false);
  assert.equal(result.unlisted.length, 1);
  assert.equal(result.unlisted[0].id, "GHSA-AAAA-BBBB-CCCC");
});

test("白名单条目过期（audit 不报了）也要失败，否则白名单变盲区", () => {
  const clean = evaluateAudit(auditWith({}), allowlist);
  assert.equal(clean.ok, false);
  assert.equal(clean.stale.length, 2);
  assert.match(formatReport(clean), /必须删掉/);
});

test("白名单条目写了但 reason / revisit 空洞：算不合格", () => {
  const problems = validateAllowlist({
    advisories: [{ id: "GHSA-x", package: "astro" }],
  });
  assert.ok(problems.some((p) => p.includes("缺 reason")));
  assert.ok(problems.some((p) => p.includes("缺 revisit")));

  const vague = validateAllowlist({ advisories: [{ id: "GHSA-y", package: "astro", reason: "没事", revisit: "以后" }] });
  assert.ok(vague.some((p) => p.includes("reason")), "reason 必须写清攻击面，不能一句「没事」");
});

test("仓库里真实的公告清单本身合格", async () => {
  const real = JSON.parse(await readFile(ALLOWLIST_FILE, "utf8"));
  assert.deepEqual(validateAllowlist(real), []);
  for (const item of real.advisories) {
    assert.match(item.reason, /静态|影响|攻击面/, `${item.id} 要写清为什么不可利用`);
    assert.ok(item.revisit.length >= 10, `${item.id} 要写清重评条件`);
  }
});

test("有 ok 场景的文案，也有失败场景的文案", () => {
  const ok = formatReport({ accepted: [{ severity: "low", package: "astro", id: "GHSA-X", title: "t" }], unlisted: [], stale: [] });
  assert.match(ok, /✓ 已评估并接受 1 条公告/);
  const empty = formatReport({ accepted: [], unlisted: [], stale: [] });
  assert.match(empty, /没有任何已知公告/);
});

test("接线：npm 脚本可跑，且进每周巡检（不进 gate）", async () => {
  const pkg = JSON.parse(await readFile(PKG, "utf8"));
  assert.equal(pkg.scripts["check:deps"], "node scripts/check-deps.mjs");
  assert.ok(!pkg.scripts.gate.includes("check:deps"), "audit 要联网，不能进 gate");

  const workflow = await readFile(WORKFLOW, "utf8");
  assert.match(workflow, /node scripts\/check-deps\.mjs/);
  assert.match(workflow, /exit \$code/, "未评估的公告要让 job 红，而不是只打日志");
});
