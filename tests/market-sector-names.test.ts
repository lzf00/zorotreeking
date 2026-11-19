import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sectorName } from "../src/lib/market-i18n";

test("常见申万板块在英文页有译文", () => {
  assert.equal(sectorName("银行", "en"), "Banks");
  assert.equal(sectorName("分立器件", "en"), "Discrete Devices");
  assert.equal(sectorName("集成电路封测", "en"), "IC Packaging & Testing");
  assert.equal(sectorName("半导体设备", "en"), "Semiconductor Equipment");
  assert.equal(sectorName("化妆品", "en"), "Cosmetics");
});

test("中文页永远显示原名，不翻译", () => {
  assert.equal(sectorName("分立器件", "zh"), "分立器件");
  assert.equal(sectorName("银行", "zh"), "银行");
});

test("没收录的板块回落到中文原名，而不是空串或英文占位", () => {
  assert.equal(sectorName("某个未来才出现的新板块", "en"), "某个未来才出现的新板块");
  assert.equal(sectorName("", "en"), "—");
  assert.equal(sectorName(null, "en"), "—");
  assert.equal(sectorName(undefined, "zh"), "—");
});

test("译文是纯 ASCII，避免英文页里冒中文", async () => {
  const src = await readFile(new URL("../src/lib/market-i18n.ts", import.meta.url), "utf8");
  const start = src.indexOf("const SECTOR_NAMES_EN");
  const block = src.slice(start, src.indexOf("};", start));
  const values = [...block.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(values.length >= 80, `译文条数太少：${values.length}`);
  for (const value of values) {
    assert.match(value, /^[\x20-\x7E]+$/, `译文含非 ASCII 字符：${value}`);
  }
});

test("看板把 lang 传到了板块列表，英文页才会翻译", async () => {
  const src = await readFile(new URL("../src/components/SectorRanking.tsx", import.meta.url), "utf8");
  assert.match(src, /sectorName\(s\.name, lang\)/);
  assert.equal((src.match(/lang=\{lang\}/g) ?? []).length, 2, "两个 SectorList 都要传 lang");
});
