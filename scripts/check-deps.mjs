#!/usr/bin/env node
/**
 * 依赖公告体检：让 `npm audit` 变成**要么干净、要么有人签过字**。
 *
 * 背景（第 77 轮）：`npm audit` 查到 astro <= 7.4.6 有 2 条 moderate 公告，修法是升到
 * 7.4.7+，但 7.4.7+ 要求 Node >= 22.23.4，而本机是 22.23.2 —— 升不上去。这类「知道有
 * 问题但暂时修不了」的情况最危险的不是漏洞本身，而是**之后所有 audit 输出都被当成噪音
 * 忽略掉**。所以把它做成一个双向校验：
 *
 *   1. audit 报了但 `scripts/dependency-advisories.json` 里没有 → 退出码 1（必须处理）
 *   2. 白名单里有但 audit 不报了 → 也算失败（条目过期了，必须删，否则白名单变盲区）
 *
 * 每条白名单必须写清 reason（为什么不可利用/不可修）和 revisit（什么条件下必须重评）。
 *
 * 用法：
 *   node scripts/check-deps.mjs               # 报告 + 退出码
 *   node scripts/check-deps.mjs --json        # 机器可读（CI 汇总用）
 *   node scripts/check-deps.mjs --offline     # 跳过 npm audit，只校验白名单文件本身
 *
 * 不进 `npm run gate`：audit 需要访问 npm registry，门禁（含 pre-push）要保持可离线跑。
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST = path.join(ROOT, "scripts", "dependency-advisories.json");

/** advisory 的稳定标识：优先 GHSA / CVE，其次 url，最后 title。 */
export function advisoryKey(via) {
  if (typeof via === "string") return via;
  const text = [via.url, via.title].filter(Boolean).join(" ");
  const ghsa = /GHSA-[a-z0-9-]+/i.exec(text)?.[0];
  if (ghsa) return ghsa.toUpperCase();
  const cve = /CVE-\d{4}-\d+/.exec(text)?.[0];
  if (cve) return cve;
  return via.title ?? via.url ?? "unknown";
}

/**
 * 把 `npm audit --json` 的输出和白名单对起来。
 * 抽成纯函数：不联网、可单测。
 *
 * @param {{ vulnerabilities?: Record<string, { via?: unknown[], severity?: string }> }} auditJson
 * @param {{ advisories?: Array<{ id: string, package?: string, reason?: string, revisit?: string }> }} allowlist
 * @returns {{ accepted: Array<object>, unlisted: Array<object>, stale: Array<object>, ok: boolean }}
 */
export function evaluateAudit(auditJson, allowlist) {
  // npm 返回的 GHSA 是大写、白名单里是人写的（大小写都有），比较前统一大写，
  // 否则会「两边都能读、就是对不上」——第一版就是这么把 2 条全判成未评估的。
  const normalize = (id) => String(id).toUpperCase();
  const allowed = new Map((allowlist.advisories ?? []).map((item) => [normalize(item.id), item]));

  // npm audit 的 vulnerabilities 是「包 → 直接/间接公告列表」，把 via 摊平成公告集合
  const found = new Map();
  for (const [name, vuln] of Object.entries(auditJson.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      // `via: ["astro"]` 这种字符串是「因为依赖了 astro 才受影响」的**反向引用**，
      // 不是一条独立公告（astro 自己的公告已经在它自己的条目里算过了）。当成公告会让
      // 「@astrojs/mdx 受 astro 影响」被误判成一条没评估过的漏洞——线上第一次接线就撞上了。
      if (typeof via !== "object" || via === null) continue;
      const key = advisoryKey(via);
      if (!found.has(key)) {
        found.set(key, {
          id: key,
          package: name,
          title: typeof via === "string" ? via : (via.title ?? ""),
          severity: typeof via === "string" ? (vuln.severity ?? "unknown") : (via.severity ?? vuln.severity ?? "unknown"),
        });
      }
    }
  }

  const accepted = [];
  const unlisted = [];
  for (const advisory of found.values()) {
    const entry = allowed.get(normalize(advisory.id));
    if (entry && (!entry.package || entry.package === advisory.package)) {
      accepted.push({ ...advisory, reason: entry.reason ?? "", revisit: entry.revisit ?? "" });
    } else {
      unlisted.push(advisory);
    }
  }

  const present = new Set([...found.keys()].map(normalize));
  const stale = (allowlist.advisories ?? [])
    .filter((item) => !present.has(normalize(item.id)))
    .map((item) => ({ id: item.id, package: item.package ?? "" }));

  return { accepted, unlisted, stale, ok: unlisted.length === 0 && stale.length === 0 };
}

/** 白名单自身也要能过：缺 reason / revisit 就等于没写。 */
export function validateAllowlist(allowlist) {
  const problems = [];
  for (const item of allowlist.advisories ?? []) {
    if (!item.id) problems.push("有条目缺 id");
    if (!item.package) problems.push(`${item.id} 缺 package`);
    if (!item.reason || item.reason.length < 20) problems.push(`${item.id} 缺 reason（说清为什么不可利用）`);
    if (!item.reason?.includes("本站") && !item.reason?.includes("影响") && !item.reason?.includes("攻击面")) {
      problems.push(`${item.id} 的 reason 太空：要写具体攻击面`);
    }
    if (!item.revisit || item.revisit.length < 10) problems.push(`${item.id} 缺 revisit（什么条件下必须重评）`);
  }
  return problems;
}

export function formatReport({ accepted, unlisted, stale }, allowlistProblems = []) {
  const lines = [];
  if (allowlistProblems.length) {
    lines.push("✗ 白名单文件本身不合格：");
    for (const problem of allowlistProblems) lines.push(`   - ${problem}`);
  }
  if (accepted.length) {
    lines.push(`✓ 已评估并接受 ${accepted.length} 条公告：`);
    for (const item of accepted) lines.push(`   - [${item.severity}] ${item.package} ${item.id}：${item.title || "(无标题)"}`);
  }
  if (unlisted.length) {
    lines.push(`✗ 有 ${unlisted.length} 条公告没评估过（要么修，要么写进 scripts/dependency-advisories.json）：`);
    for (const item of unlisted) lines.push(`   - [${item.severity}] ${item.package} ${item.id}：${item.title}`);
  }
  if (stale.length) {
    lines.push(`✗ 白名单 ${stale.length} 条已经不再出现，必须删掉（不然白名单会变成盲区）：`);
    for (const item of stale) lines.push(`   - ${item.package} ${item.id}`);
  }
  if (!accepted.length && !unlisted.length && !stale.length && !allowlistProblems.length) lines.push("✓ 依赖里没有任何已知公告");
  return lines.join("\n");
}

async function readAuditJson() {
  try {
    // npm audit 在「有漏洞」时退出码非 0，但 stdout 仍是合法 JSON —— 不能因为退出码就丢结果
    const { stdout } = await execFileAsync("npm", ["audit", "--omit=dev", "--json"], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, npm_config_cache: process.env.npm_config_cache ?? "/tmp/npm-cache" },
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch {
        /* 落到下面 */
      }
    }
    throw new Error(`npm audit 跑不起来：${error.message}`);
  }
}

async function main() {
  const json = process.argv.includes("--json");
  const offline = process.argv.includes("--offline");

  const allowlist = JSON.parse(await readFile(ALLOWLIST, "utf8"));
  const allowlistProblems = validateAllowlist(allowlist);

  if (offline) {
    const text = allowlistProblems.length ? formatReport({ accepted: [], unlisted: [], stale: [] }, allowlistProblems) : "✓ 白名单文件格式合格";
    if (json) process.stdout.write(`${JSON.stringify({ ok: allowlistProblems.length === 0, allowlistProblems }, null, 2)}\n`);
    else process.stdout.write(`${text}\n`);
    process.exit(allowlistProblems.length === 0 ? 0 : 1);
  }

  const auditJson = await readAuditJson();
  const result = evaluateAudit(auditJson, allowlist);
  if (json) {
    process.stdout.write(`${JSON.stringify({ ...result, allowlistProblems, totals: auditJson.metadata?.vulnerabilities ?? {} }, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReport(result, allowlistProblems)}\n`);
    // npm audit 数的是「有漏洞的包」，公告是「条」，两个数字对不上是正常的
    const total = auditJson.metadata?.vulnerabilities?.total ?? 0;
    process.stdout.write(
      `\nnpm audit：${total} 个包有公告 → 展开成 ${result.accepted.length + result.unlisted.length} 条，已接受 ${result.accepted.length}、未评估 ${result.unlisted.length}\n`,
    );
  }
  process.exit(result.ok && allowlistProblems.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
