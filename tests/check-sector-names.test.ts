import assert from "node:assert/strict";
import test from "node:test";

import { dictionaryKeys, unmappedSectors } from "../scripts/check-sector-names.mjs";

const SOURCE = `
const SECTOR_NAMES_EN: Record<string, string> = {
  银行: "Banks",
  "银行Ⅱ": "Banks II",
  "IC设计": "IC Design",
};
`;

test("能从源码里解析带引号和不带引号的键", () => {
  const keys = dictionaryKeys(SOURCE);
  assert.deepEqual([...keys].sort(), ["IC设计", "银行", "银行Ⅱ"].sort());
  assert.equal(dictionaryKeys("no dictionary here").size, 0);
});

test("未覆盖的板块只报一次，空名与重复名忽略", () => {
  const keys = dictionaryKeys(SOURCE);
  const missing = unmappedSectors(["银行", "新板块", "新板块", "", null, "银行Ⅱ"], keys);
  assert.deepEqual(missing, ["新板块"]);
});

test("全部覆盖时返回空数组（build 不吵）", () => {
  const keys = dictionaryKeys(SOURCE);
  assert.deepEqual(unmappedSectors(["银行", "IC设计"], keys), []);
});
