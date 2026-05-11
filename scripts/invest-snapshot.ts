/**
 * 月度持仓快照脚本：
 *   1) 读取 src/content/invest-portfolio/_holdings.yaml（手工维护的持仓代码+股数+成本）
 *   2) 拉新浪财经实时报价，算市值与权重
 *   3) 写一份 src/content/invest-portfolio/<YYYY-MM>.yaml
 *
 * 用法：
 *   npx tsx scripts/invest-snapshot.ts            # 当前年月
 *   npx tsx scripts/invest-snapshot.ts 2026-05   # 指定年月
 *
 * 此脚本既可手工运行做月末快照，也可由 GitHub Actions cron 每日触发。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2];
const now = new Date();
const period =
  arg ??
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

type Holding = { symbol: string; name: string; market: "A" | "HK" | "US" | "ETF" | "Crypto" | "Cash" | "Other"; shares: number; costAvg: number };

async function fetchSinaQuotes(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  // 用国内 A 股代码（sh000001/sz399001 类似），ETF 用 sh/sz 前缀的标准代码
  const list = symbols.join(",");
  const resp = await fetch(`https://hq.sinajs.cn/list=${list}`, {
    headers: { Referer: "https://finance.sina.com.cn" },
  });
  // sina 返回的是 GBK 编码；但 Node 默认按 utf-8 读取会丢失中文名。
  // 这里只关心当前价（CSV 第 3 列），它是 ASCII，不受影响。
  const text = await resp.text();
  const out: Record<string, number> = {};
  for (const line of text.split("\n")) {
    if (!line.includes("=")) continue;
    const m = line.match(/^var\s+hq_str_(\w+)=\"([^"]*)\"/);
    if (!m) continue;
    const sym = m[1];
    const fields = m[2].split(",");
    const price = parseFloat(fields[3] || "0");
    if (Number.isFinite(price) && price > 0) out[sym] = price;
  }
  return out;
}

async function main() {
  const holdingsPath = path.join(PROJECT_ROOT, "src", "content", "invest-portfolio", "_holdings.yaml");
  const raw = await fs.readFile(holdingsPath, "utf-8");

  // 极简 yaml 解析（仅支持本脚本期望的格式：- key: value）
  // 真用 yaml 库更稳，但避免引依赖
  const holdings = parseSimpleYaml(raw) as { holdings: Holding[]; notes?: string };

  const symbols = holdings.holdings.filter((h) => h.market === "A" || h.market === "ETF").map((h) => h.symbol);
  const quotes = await fetchSinaQuotes(symbols);

  let totalValue = 0;
  const items = holdings.holdings.map((h) => {
    const price = quotes[h.symbol] ?? h.costAvg;  // 缺报价时按成本估
    const marketValue = Math.round(price * h.shares * 100) / 100;
    totalValue += marketValue;
    return { ...h, lastPrice: price, marketValue, weight: 0 };
  });
  for (const it of items) it.weight = Math.round((it.marketValue / totalValue) * 10000) / 10000;

  const out = {
    period,
    asOf: new Date().toISOString(),
    currency: "CNY",
    totalValue: Math.round(totalValue * 100) / 100,
    holdings: items,
    notes: holdings.notes ?? "",
  };

  const outPath = path.join(PROJECT_ROOT, "src", "content", "invest-portfolio", `${period}.yaml`);
  await fs.writeFile(outPath, dumpSimpleYaml(out));
  console.log(`✓ wrote ${path.relative(PROJECT_ROOT, outPath)}`);
  console.log(`  total: ¥${out.totalValue.toLocaleString()}, ${items.length} positions, ${Object.keys(quotes).length} quotes fetched`);
}

function parseSimpleYaml(s: string): any {
  // 仅处理：顶层 key: value、 顶层 list （holdings:）
  const lines = s.split("\n").map((l) => l.replace(/\s+$/, ""));
  const root: any = {};
  let cur: any = root;
  let curList: any[] | null = null;
  let curListKey = "";
  let curItem: any = null;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (line.startsWith("  - ")) {
      // 列表新项
      curItem = {};
      curList!.push(curItem);
      const rest = line.slice(4);
      const [k, ...v] = rest.split(":");
      curItem[k.trim()] = coerce(v.join(":").trim());
    } else if (line.startsWith("    ")) {
      // 列表子字段
      const [k, ...v] = line.trim().split(":");
      curItem[k.trim()] = coerce(v.join(":").trim());
    } else if (line.endsWith(":")) {
      const key = line.slice(0, -1).trim();
      curList = [];
      curListKey = key;
      cur[key] = curList;
    } else {
      const [k, ...v] = line.split(":");
      cur[k.trim()] = coerce(v.join(":").trim());
    }
  }
  return root;
}

function coerce(v: string): any {
  if (v === "" || v == null) return "";
  if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

function dumpSimpleYaml(obj: any): string {
  const out: string[] = [];
  out.push(`period: "${obj.period}"`);
  out.push(`asOf: ${obj.asOf}`);
  out.push(`currency: ${obj.currency}`);
  out.push(`totalValue: ${obj.totalValue}`);
  out.push(`holdings:`);
  for (const h of obj.holdings) {
    out.push(`  - symbol: "${h.symbol}"`);
    out.push(`    name: "${h.name}"`);
    out.push(`    market: ${h.market}`);
    out.push(`    shares: ${h.shares}`);
    out.push(`    costAvg: ${h.costAvg}`);
    out.push(`    lastPrice: ${h.lastPrice}`);
    out.push(`    marketValue: ${h.marketValue}`);
    out.push(`    weight: ${h.weight}`);
  }
  if (obj.notes) out.push(`notes: "${String(obj.notes).replace(/"/g, '\\"')}"`);
  return out.join("\n") + "\n";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
