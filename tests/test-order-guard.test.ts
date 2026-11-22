/**
 * 测试不许"偷偷依赖构建产物"（第 181 轮）。
 *
 * 事故：我给 `/now` 写了条测试，直接 `readFile("../dist/now/index.html")`。
 * 本地 `npm run gate` 里 `dist/` 早就在（上一轮构建留下的），所以一直是绿的；
 * 而 CI 的 `deploy.yml` 是**先跑测试（第 5 步）再构建（第 11 步）** ——
 * 于是两次部署都挂在 "Unit and guard tests"，站点停在旧版本。
 *
 * 这类错误的可怕之处是**本地完全看不见**：门禁绿的，部署红着。
 * 所以这里把"CI 顺序"变成一条可以本地执行的规则：任何读 `../dist/` 的测试必须有兜底。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const DIR = new URL("../tests/", import.meta.url);
const FALLBACKS = [/\.catch\(\s*\(\s*\)\s*=>\s*null\s*\)/, /existsSync\(/, /\.catch\(\(\) => null\)/];

test("读 dist/ 的测试必须自己兜底（CI 先跑测试、后构建）", () => {
  const offenders: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".test.ts"))) {
    const text = readFileSync(new URL(file, DIR), "utf8");
    if (file === "test-order-guard.test.ts") continue; // 这条规则自己就写着 dist 两个字
    if (!/\.\.\/dist\//.test(text)) continue;
    if (FALLBACKS.some((re) => re.test(text))) continue;
    offenders.push(file);
  }
  assert.deepEqual(offenders, [], `这些测试读了 ../dist/ 却没有兜底，CI 里会因为没有构建产物而失败：${offenders.join(", ")}`);
});

test("前提仍成立：deploy.yml 的测试步骤排在构建之前", async () => {
  const yml = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const tests = yml.indexOf("Unit and guard tests");
  const build = yml.indexOf("name: Build site");
  assert.ok(tests > 0 && build > 0, "找不到这两步");
  assert.ok(tests < build, "顺序变了的话，dist 依赖的测试就不再有风险 —— 这条守卫要跟着改");
});
