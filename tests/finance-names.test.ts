/**
 * 英文日报的名字对照表（第 156 轮）。
 *
 * 事故：`build_report_en` 只有 16 个名字的对照表，`## 🔥 Top Gainers` 和
 * `## 💰 Hot Sectors` 直接输出中文名 —— 同一张表里一半 "Banking"、一半 "酿酒行业"。
 * 20 个 `market-recap-*.en.mdx` 累计 157 个中文表格单元格。
 *
 * 修法：`scripts/wind/finance_names.py`（板块名可以安全意译；个股只收有公开英文名的，
 * 查不到就保留中文 —— 编一个像官方译名的名字比留着中文更糟），
 * `fetcher.py` 的英文版对热股/板块/领涨股都走 `_en_name`，另加一次性回填脚本。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function python<T>(code: string): T {
  const out = execFileSync("python3", ["-c", code], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });
  return JSON.parse(out) as T;
}

test("对照表能独立 import（服务器上 fetcher.py 不一定装了第三方包）", async () => {
  const source = await read("scripts/wind/finance_names.py");
  assert.doesNotMatch(source, /^\s*import (akshare|requests|pandas)/m, "不能依赖第三方包");
  const counts = python<{ sectors: number; stocks: number }>(
    "import sys, json; sys.path.insert(0, 'scripts/wind'); import finance_names as f; print(json.dumps({'sectors': len(f.SECTOR_EN), 'stocks': len(f.STOCK_EN)}))",
  );
  assert.ok(counts.sectors >= 100, `板块名至少 100 条，实际 ${counts.sectors}`);
  assert.ok(counts.stocks >= 100, `个股名至少 100 条，实际 ${counts.stocks}`);
});

test("板块名翻译成英文，未知名字原样保留", () => {
  const got = python<Record<string, string>>(`
import sys, json
sys.path.insert(0, 'scripts/wind')
from finance_names import en_name
print(json.dumps({
  "sector": en_name("酿酒行业"),
  "stock": en_name("北方华创"),
  "unknown": en_name("量子科技某公司"),
  "empty": en_name(""),
}))
`);
  assert.equal(got.sector, "Alcoholic Beverages");
  assert.equal(got.stock, "NAURA Technology");
  assert.equal(got.unknown, "量子科技某公司", "没把握的名字必须原样保留，不能瞎翻");
  assert.equal(got.empty, "");
});

test("英文日报的热股、板块、领涨股都走对照表", async () => {
  const fetcher = await read("scripts/wind/fetcher.py");
  assert.match(fetcher, /_en_name\(h\['name'\]\)/, "Top Gainers 要走对照表");
  assert.match(fetcher, /_en_name\(s\['name'\]\)/, "Hot Sectors 要走对照表");
  assert.match(fetcher, /_en_name\(s\.get\('lead_stock'\)\)/, "领涨股要走对照表");
  assert.match(fetcher, /from finance_names import en_name/, "要真的用上那个模块");
});

test("已发布的英文日报里，表格单元格不再留着能翻的中文名", async () => {
  const keys = python<string[]>(
    "import sys, json; sys.path.insert(0, 'scripts/wind'); import finance_names as f; print(json.dumps(list({**f.SECTOR_EN, **f.STOCK_EN}.keys())))",
  );
  const known = new Set(keys);
  const dir = new URL("../src/content/invest/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => /^market-recap-.*\.en\.mdx$/.test(f));
  assert.ok(files.length > 10, "应当能扫到日报文件");
  const leftovers: string[] = [];
  for (const file of files) {
    const raw = await readFile(new URL(file, dir), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trimStart().startsWith("|")) continue;
      for (const cell of line.split("|")) {
        const bare = cell.replace(/`[^`]*`/g, "").replace(/[🟢🔴⚪🚀💥💰]/gu, "").trim();
        if (known.has(bare)) leftovers.push(`${file}: ${bare}`);
      }
    }
  }
  assert.deepEqual(leftovers.slice(0, 5), [], "这些名字对照表里有，说明回填没跑干净");
});

test("生成端在发布前自己回填，不靠「事后一次性脚本」（第 183 轮）", async () => {
  // 事故：回填脚本只跑过一次，新生成的英文日报照样把中文名写进表格 ——
  // 撞上本文件的守卫后**每次部署都失败**，线上停在 02:00 的旧版本（2026-11-23）。
  const publisher = await read("scripts/wind/publisher.py");
  assert.match(publisher, /from backfill_en_names import fix_markdown/, "发布前必须调用回填");
  assert.match(publisher, /fix_markdown\(en_mdx\)/, "要作用在英文正文上");

  // 用 chr(10) 拼换行，避免测试里三层转义（TS 模板 → Python 字符串 → markdown）
  const fixed = python<{ cells: number; text: string }>(`
import sys, json
sys.path.insert(0, 'scripts/wind')
from backfill_en_names import fix_markdown
nl = chr(10)
table = nl.join(["| Stock | Price |", "|---|---|", "| 🔴 新易盛 | 170 |", "| 🟢 CATL | 225 |", ""])
text, n = fix_markdown(table)
print(json.dumps({"cells": n, "text": text}))
`);
  assert.equal(fixed.cells, 1, "只改表格单元格里的已知名字");
  assert.match(fixed.text, /Eoptolink Technology/);
  assert.match(fixed.text, /CATL/, "已经是英文的不动");
});

test("回填不会误伤正文和代码列", () => {
  const got = python<{ cells: number; text: string }>(`
import sys, json
sys.path.insert(0, 'scripts/wind')
from backfill_en_names import fix_markdown
nl = chr(10)
bt = chr(96)
body = nl.join(["正文里提到新易盛也不能动。", "", "| Stock | Code |", "|---|---|",
                "| 新易盛 | " + bt + "300502.SZ" + bt + " |", ""])
text, n = fix_markdown(body)
print(json.dumps({"cells": n, "text": text}))
`);
  assert.equal(got.cells, 1);
  assert.match(got.text, /正文里提到新易盛也不能动/, "正文一个字不碰");
  // 代码本来就在自己的单元格里，回填只换名字那一格
  assert.match(got.text, /\| Eoptolink Technology \| `300502\.SZ` \|/, "股票代码要留在表里");
});
