import assert from "node:assert/strict";
import test from "node:test";

import { formatYi, marketLabels } from "../src/lib/market-i18n";
import { parseHoldings, stockSeeds } from "../src/lib/invest-dashboard";

test("解析持仓底表：只取 holdings 段，遇到下一个顶级 key 停止", () => {
  const yaml = `portfolioMode: simulation
simulationStartDate: "2026-02-01"
holdings:
  - symbol: "000001"
    name: "测试基金A"
    shares: 1000
    costAvg: 1.2345
    initialCapital: 10000
    baselineDate: "2026-02-02"
  - symbol: "000002"
    name: "测试基金B"   # 行尾注释
    shares: 500
    costAvg: 2.5
notes:
  - symbol: "999999"
    name: "不该被读进来"
`;
  const rows = parseHoldings(yaml);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    symbol: "000001",
    name: "测试基金A",
    shares: 1000,
    costAvg: 1.2345,
    initialCapital: 10000,
    baselineDate: "2026-02-02",
  } satisfies Record<string, unknown> as never);
  assert.equal(rows[1].name, "测试基金B");
});

test("股票池中英各一套，secid 保持一致", () => {
  const zh = stockSeeds("zh");
  const en = stockSeeds("en");
  assert.equal(zh.aiKechuang.length, en.aiKechuang.length);
  assert.deepEqual(zh.aiKechuang.map((s) => s.secid), en.aiKechuang.map((s) => s.secid));
  assert.equal(zh.aiKechuang[0].display_name, "中芯国际");
  assert.equal(en.aiKechuang[0].display_name, "SMIC");
  // 英文名不能还留中文
  for (const seed of [...en.aiKechuang, ...en.chinext]) {
    assert.doesNotMatch(seed.display_name + seed.note, /[\u4e00-\u9fa5]/, `中英混用: ${seed.secid}`);
  }
});

test("成交额单位随语言换算：中文亿/万亿，英文B/T", () => {
  assert.equal(formatYi(1200, "zh"), "1200.00 亿");
  assert.equal(formatYi(12345, "zh"), "1.23 万亿");
  assert.equal(formatYi(1200, "en"), "120.0B");
  assert.equal(formatYi(12345, "en"), "1.23T");
  assert.equal(formatYi(Number.NaN, "en"), "—");
});

test("两个语言的标签都有值，且英文不含中文", () => {
  const zh = marketLabels("zh");
  const en = marketLabels("en");
  for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
    if (key === "lang") continue;
    assert.notEqual(zh[key], undefined, `中文缺 ${String(key)}`);
    assert.notEqual(en[key], undefined, `英文缺 ${String(key)}`);
  }
  const flat = [
    en.loadFailed, en.networkError, en.retry, en.sectionToday, en.sectionSentiment,
    en.sectionSectors, en.colCode, en.colName, en.disclaimer, en.holdingsSource,
  ].join(" ");
  assert.doesNotMatch(flat, /[\u4e00-\u9fa5]/);
  // 参数化文案也要能正常展开
  assert.equal(en.perFund(3), "3 funds · ¥10,000 each");
  assert.equal(en.dateRange("2026-01-01", "2026-02-01"), "2026-01-01 – 2026-02-01");
});
