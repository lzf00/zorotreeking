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
  assert.equal(
    urls.some((u) => u.endsWith("/hike/sample-route/")),
    false,
    "地图页数值不稳，确认稳定前不应回到门禁里",
  );
  assert.equal(urls.length, 14);
});
