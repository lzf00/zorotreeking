/**
 * 把 audit-site 的 JSONL 汇总成一段 Markdown（GitHub job summary 直接 append）。
 *
 * 纯函数放在 lib 里：发布流程、周报、本地排查都用同一套口径，
 * 也让「口径对不对」可以被测试盯住（曾经在 workflow 里内联 60 行 JS，改一次错一次）。
 */

/** 单页记录：{ url, status, lcp?, cls?, lcpEl?, issues?: string[] } */
export function summarizeSiteAudit(rows) {
  if (!rows.length) return { markdown: "## 全站巡检：报告为空\n", failures: 0, pages: 0 };

  const failures = rows.filter((row) => row.issues?.length);
  const byStatus = new Map();
  for (const row of rows) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);

  const lines = [];
  lines.push(`## 全站巡检：${rows.length} 页，失败 ${failures.length} 页`);
  lines.push("");
  lines.push("| 状态码 | 页数 |");
  lines.push("| --- | --- |");
  for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${status || "无响应"} | ${count} |`);
  }

  if (failures.length) {
    // 按问题类型归组：「32 页都是同一张图 404」比「32 条独立失败」有用得多
    const groups = new Map();
    for (const row of failures) {
      for (const issue of row.issues) {
        const key = issue.replace(/\/[^/]*\.(webp|jpg|png|avif|js|css)/gi, "/…").slice(0, 120);
        const cur = groups.get(key) ?? { key, urls: [] };
        cur.urls.push(row.url);
        groups.set(key, cur);
      }
    }
    lines.push("");
    lines.push("### 失败归组");
    lines.push("");
    lines.push("| 问题 | 页数 | 例 |");
    lines.push("| --- | --- | --- |");
    for (const [key, group] of [...groups.entries()].sort((a, b) => b[1].urls.length - a[1].urls.length).slice(0, 12)) {
      lines.push(`| ${key} | ${group.urls.length} | ${group.urls[0]} |`);
    }
    lines.push("");
    lines.push("### 失败页（前 20）");
    lines.push("");
    for (const row of failures.slice(0, 20)) {
      lines.push(`- \`${row.url}\` → ${row.issues[0]}`);
      for (const issue of row.issues.slice(1, 3)) lines.push(`  - ${issue}`);
    }
  } else {
    lines.push("");
    lines.push("全部通过 ✅");
  }

  const withLcp = rows.filter((row) => row.lcp > 0);
  if (withLcp.length) {
    const sorted = [...withLcp].sort((a, b) => b.lcp - a.lcp);
    // 中位数按升序取（两页时取较小的那页，避免「只有两页也叫中位」时给出偏乐观的数字）
    const ascending = [...withLcp].map((row) => row.lcp).sort((a, b) => a - b);
    // 取「下中位」：偶数个样本时取较小的一侧，报告不会因为少一页而显得更好看
    const median = ascending[Math.floor((ascending.length - 1) / 2)];
    lines.push("");
    lines.push(`### 首屏（本地/线上均未节流）：LCP 中位 ${median} ms，最慢 ${sorted[0].lcp} ms`);
    lines.push("");
    lines.push("| LCP | 页面 | 元素 |");
    lines.push("| --- | --- | --- |");
    for (const row of sorted.slice(0, 10)) lines.push(`| ${row.lcp} ms | ${row.url} | ${row.lcpEl ?? ""} |`);
  }

  const withCls = rows.filter((row) => typeof row.cls === "number" && row.cls > 0.01);
  if (withCls.length) {
    const sorted = [...withCls].sort((a, b) => b.cls - a.cls);
    lines.push("");
    lines.push(`### 有位移的页面（CLS > 0.01，共 ${withCls.length} 页）`);
    lines.push("");
    lines.push("| CLS | 页面 |");
    lines.push("| --- | --- |");
    for (const row of sorted.slice(0, 10)) lines.push(`| ${row.cls.toFixed(3)} | ${row.url} |`);
  }

  return { markdown: `${lines.join("\n")}\n`, failures: failures.length, pages: rows.length };
}

/** JSONL 文本 → 记录数组（坏行跳过，不让一条脏数据毁掉整份报告） */
export function parseAuditJsonl(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row && typeof row.url === "string") rows.push(row);
    } catch {}
  }
  return rows;
}
