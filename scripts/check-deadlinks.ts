/**
 * 死链巡查：扫所有 mdx 里的外链（http/https），HEAD 探测，列出 4xx/5xx/超时。
 *
 * 设计：
 *   - 并发 8，单链 timeout 12s
 *   - 自动 follow redirect
 *   - 用 HEAD 优先（很多源不支持 HEAD 会 405 → 自动 fallback GET range:0-0）
 *   - GitHub / arxiv / huggingface 这类大站做更高容忍：429/403 不算死
 *   - 输出报告到 reports/deadlinks-YYYY-MM-DD.json
 *
 * 用法：
 *   npx tsx scripts/check-deadlinks.ts                # 扫全部
 *   npx tsx scripts/check-deadlinks.ts --limit=50     # 只扫前 50 个
 *   npx tsx scripts/check-deadlinks.ts --section=ai   # 只扫某栏目
 *   npx tsx scripts/check-deadlinks.ts --concurrency=4 # 调并发
 *
 * 后续可接入 cron 周扫 + 飞书推坏链清单。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);

const LIMIT = (() => {
  const m = ARGS.find((a) => a.startsWith("--limit="));
  return m ? parseInt(m.split("=")[1], 10) || Infinity : Infinity;
})();
const SECTION = (() => {
  const m = ARGS.find((a) => a.startsWith("--section="));
  return m ? m.split("=")[1] : null;
})();
const CONCURRENCY = (() => {
  const m = ARGS.find((a) => a.startsWith("--concurrency="));
  return m ? Math.max(1, Math.min(16, parseInt(m.split("=")[1], 10) || 8)) : 8;
})();

// 这些域名 4xx/5xx 当假阳性（rate-limit / WAF / 不支持 HEAD）。
const TOLERATED_DOMAINS = [
  "github.com", "twitter.com", "x.com", "linkedin.com",
  "huggingface.co",  // 偶尔 403/429
  "openai.com",      // WAF 严格
  "anthropic.com",
];

// 不扫的域名（私有 / 内网 / localhost）
const SKIP_DOMAINS = [
  "localhost", "127.0.0.1", "0.0.0.0",
];

// 默认 timeout
const TIMEOUT_MS = 12_000;

type LinkRef = { url: string; fromFile: string };
type LinkResult = LinkRef & {
  status: number | null;
  ok: boolean;
  tolerated: boolean;
  reason?: string;
};

const URL_RE = /https?:\/\/[^\s"'<>\)\]\}]+/g;

async function collectLinks(): Promise<LinkRef[]> {
  const out: LinkRef[] = [];
  const seen = new Set<string>();
  const cols = SECTION ? [SECTION] : ["ai", "invest", "photo", "hike"];
  for (const col of cols) {
    const dir = path.join(ROOT, "src", "content", col);
    let files: string[];
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".mdx")) continue;
      const p = path.join(dir, f);
      const text = await fs.readFile(p, "utf-8");
      const matches = text.match(URL_RE) || [];
      for (let url of matches) {
        // 去掉尾部标点
        url = url.replace(/[.,;:!?]+$/, "");
        // 去掉 markdown 链接闭合括号、html 实体收尾
        url = url.replace(/[)>]+$/, "");
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ url, fromFile: `${col}/${f}` });
      }
    }
  }
  return out;
}

function shouldSkip(url: string): boolean {
  try {
    const u = new URL(url);
    return SKIP_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function isTolerated(url: string, status: number | null): boolean {
  if (status === null) return false;
  if (status < 400) return true;
  try {
    const u = new URL(url);
    return TOLERATED_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

async function probe(url: string): Promise<LinkResult> {
  const baseRef: LinkRef = { url, fromFile: "" };
  if (shouldSkip(url)) {
    return { ...baseRef, status: null, ok: true, tolerated: true, reason: "skipped" };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    // 先尝试 HEAD（节省带宽）
    let r = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 ZoroTreekingLinkCheck/1.0" },
    }).catch(() => null);
    // HEAD 不被支持或 405 → GET with Range 拉头部（节省）
    if (!r || r.status === 405 || r.status === 501) {
      r = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: ctl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 ZoroTreekingLinkCheck/1.0",
          "Range": "bytes=0-0",
        },
      });
    }
    const status = r?.status ?? 0;
    const ok = status > 0 && status < 400;
    const tolerated = !ok && isTolerated(url, status);
    return { ...baseRef, status, ok, tolerated };
  } catch (e: any) {
    return { ...baseRef, status: null, ok: false, tolerated: false, reason: e.name === "AbortError" ? "timeout" : (e.message || "err").slice(0, 100) };
  } finally {
    clearTimeout(timer);
  }
}

async function poolMap<T, R>(items: T[], fn: (x: T, i: number) => Promise<R>, conc: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0, done = 0;
  const total = items.length;
  return new Promise((resolve) => {
    function next() {
      if (idx >= items.length) {
        if (done === total) resolve(results);
        return;
      }
      const i = idx++;
      fn(items[i], i)
        .then((v) => { results[i] = v; })
        .catch(() => { /* shouldn't happen, fn never throws */ })
        .finally(() => {
          done++;
          if (done % 20 === 0 || done === total) {
            process.stdout.write(`\r  扫描中 ${done} / ${total}`);
          }
          next();
        });
    }
    if (items.length === 0) { resolve(results); return; }
    for (let k = 0; k < Math.min(conc, items.length); k++) next();
  });
}

async function main() {
  console.log(`[deadlinks] 收集外链…`);
  const allRefs = await collectLinks();
  console.log(`  收集到 ${allRefs.length} 个独立外链${SECTION ? ` (栏目=${SECTION})` : ""}`);
  const refs = Number.isFinite(LIMIT) ? allRefs.slice(0, LIMIT) : allRefs;
  if (refs.length < allRefs.length) console.log(`  --limit=${LIMIT} 只扫前 ${refs.length} 个`);

  console.log(`[deadlinks] 并发 ${CONCURRENCY} 探测…`);
  const results = await poolMap(refs, async (ref) => {
    const r = await probe(ref.url);
    return { ...r, fromFile: ref.fromFile };
  }, CONCURRENCY);
  console.log();

  const dead = results.filter((r) => !r.ok && !r.tolerated);
  const tolerated = results.filter((r) => !r.ok && r.tolerated);
  const okCount = results.length - dead.length - tolerated.length;

  console.log();
  console.log(`╔════ 死链巡查报告 ════════════════════════════════════╗`);
  console.log(`  ✓ 健康     : ${okCount}`);
  console.log(`  ⚠ 容忍     : ${tolerated.length}（rate-limit / WAF 域名）`);
  console.log(`  ✗ 死链     : ${dead.length}`);
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log();

  if (dead.length > 0) {
    console.log("❌ 死链清单：");
    for (const d of dead.slice(0, 50)) {
      const tag = d.status ? `HTTP ${d.status}` : (d.reason || "fail");
      console.log(`  [${tag}] ${d.url}`);
      console.log(`           from ${d.fromFile}`);
    }
    if (dead.length > 50) console.log(`  ... 还有 ${dead.length - 50} 个死链`);
  }

  // 写报告
  const reportsDir = path.join(ROOT, "reports");
  await fs.mkdir(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(reportsDir, `deadlinks-${stamp}.json`);
  await fs.writeFile(reportPath, JSON.stringify({
    runAt: new Date().toISOString(),
    total: results.length,
    ok: okCount,
    tolerated: tolerated.length,
    dead: dead.length,
    deadList: dead,
  }, null, 2));
  console.log(`\n📄 报告写入: ${path.relative(ROOT, reportPath)}`);

  // 推飞书（仅当死链 > 0 且配置了 webhook）
  const webhook = process.env.FEISHU_DEADLINK_WEBHOOK || "";
  if (webhook && dead.length > 0) {
    try {
      await pushToFeishu(webhook, dead, okCount, tolerated.length);
      console.log(`📢 飞书推送成功（${dead.length} 条死链）`);
    } catch (e) {
      console.warn(`⚠ 飞书推送失败: ${(e as Error).message}`);
    }
  } else if (!webhook) {
    console.log("ℹ️  未配置 FEISHU_DEADLINK_WEBHOOK，跳过飞书推送");
  }

  process.exit(dead.length > 0 ? 1 : 0);
}

/** 飞书交互卡片推送。分组按 file 归拢，每组最多 5 条。 */
async function pushToFeishu(webhook: string, dead: LinkResult[], ok: number, tolerated: number): Promise<void> {
  // 按 fromFile 分组
  const groups: Record<string, LinkResult[]> = {};
  for (const d of dead) {
    (groups[d.fromFile] ??= []).push(d);
  }
  const groupCount = Object.keys(groups).length;

  const elements: any[] = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**🔍 zorotreeking 死链周报**\n\n✓ 健康 **${ok}** · ⚠ 容忍 **${tolerated}** · ✗ 死链 **${dead.length}**（分布在 ${groupCount} 个文件）`,
      },
    },
    { tag: "hr" },
  ];

  const sortedGroups = Object.entries(groups).slice(0, 10);
  for (const [file, links] of sortedGroups) {
    const lines = links.slice(0, 5).map((l) => {
      const tag = l.status ? `HTTP ${l.status}` : (l.reason || "fail");
      return `- \`${tag}\` ${l.url.slice(0, 100)}`;
    });
    if (links.length > 5) lines.push(`  ... 还有 ${links.length - 5} 条`);
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `📄 **${file}** (${links.length})\n${lines.join("\n")}`,
      },
    });
  }
  if (Object.keys(groups).length > 10) {
    elements.push({
      tag: "note",
      elements: [{
        tag: "plain_text",
        content: `... 还有 ${Object.keys(groups).length - 10} 个文件有死链，完整清单看 GH Actions artifact`,
      }],
    });
  }
  elements.push({ tag: "hr" });
  elements.push({
    tag: "action",
    actions: [{
      tag: "button",
      text: { tag: "plain_text", content: "查看仓库" },
      url: "https://github.com/lzf00/zorotreeking",
      type: "default",
    }],
  });

  const payload = {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: "orange",
        title: { tag: "plain_text", content: "死链周报 · zorotreeking" },
      },
      elements,
    },
  };

  const resp = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw new Error(`飞书 HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
