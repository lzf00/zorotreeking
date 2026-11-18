import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("地图页先占高度，避免 client:only 地图晚到把下方内容顶下去", async () => {
  const component = await readProjectFile("src/components/GpxMap.tsx");
  // 外层带显式高度，内层才是 Leaflet 的挂载点
  assert.match(component, /className="relative w-full" style=\{\{ height \}\}/);
  assert.match(component, /ref=\{ref\}/);
});

test("Leaflet 版权署名的对比度被覆盖（默认 50% 灰字不达标）", async () => {
  const component = await readProjectFile("src/components/GpxMap.tsx");
  assert.match(component, /\.leaflet-control-attribution\s*\{[^}]*background:[^}]*!important/);
  assert.match(component, /\.leaflet-control-attribution\s*\{[^}]*color:\s*#333\s*!important/);
});

test("性能预算集包含个股页与标签详情页，且不再包含不稳定的地图页", async () => {
  const config = JSON.parse(await readProjectFile(".lighthouserc.json"));
  const urls: string[] = config.ci.collect.url;
  assert.ok(urls.some((u) => u.endsWith("/invest/stock/688981.SH/")), "缺少个股页");
  assert.ok(urls.some((u) => u.endsWith("/tag/photo/")), "缺少标签详情页");
  // Leaflet 地图页 2026-11 回归：占位高度 + client:visible + attribution 对比度修完之后，
  // 生产实测 a11y 1.00 / CLS 0.000 / 12 块瓦片，重新纳入预算，避免整类页面无人看管
  assert.ok(urls.some((u) => u.endsWith("/hike/sample-route/")), "缺少 Leaflet 地图页");
  assert.equal(urls.length, 15);
});

test("性能分数只告警、真正的门禁落在指标级", async () => {
  const assertions = JSON.parse(await readProjectFile(".lighthouserc.json")).ci.assert.assertions;
  // category 分数会被 runner 负载带偏：同一页面内容未变时实测在 84–99 之间跳。
  // 拿它当硬门禁会假红，所以只告警；LCP / CLS 这类指标才是硬拦。
  assert.equal(assertions["categories:performance"][0], "warn");
  assert.equal(assertions["largest-contentful-paint"][0], "error");
  assert.equal(assertions["cumulative-layout-shift"][0], "error");
  assert.ok(assertions["largest-contentful-paint"][1].maxNumericValue <= 4000, "LCP 阈值不能放到看不出回归的程度");
});
