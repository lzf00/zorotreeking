#!/usr/bin/env node
/**
 * `node scripts/summarize-site-audit.mjs reports/site-audit.jsonl >> $GITHUB_STEP_SUMMARY`
 *
 * 只做一件事：读 JSONL、打印 Markdown、按失败数量给退出码（给本地排查用）。
 * 汇总口径都在 scripts/lib/summarize-audit.mjs，测试盯着那里。
 */
import { readFile } from "node:fs/promises";

import { parseAuditJsonl, summarizeSiteAudit } from "./lib/summarize-audit.mjs";

const file = process.argv[2] ?? "reports/site-audit.jsonl";
const text = await readFile(file, "utf8").catch((error) => {
  console.error(`读不到 ${file}：${error.message}`);
  process.exit(2);
});

const rows = parseAuditJsonl(text);
const { markdown, failures } = summarizeSiteAudit(rows);
process.stdout.write(markdown);

// Summary 里已经写清楚了，这里只用退出码告诉调用方「有没有要人看的」
if (failures > 0) console.error(`::warning title=全站巡检发现 ${failures} 页问题::详见 job summary 与 artifact`);
process.exit(0);
