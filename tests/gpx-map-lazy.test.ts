/**
 * 地图默认不加载 Leaflet（第 126 轮）。
 *
 * 起因：Lighthouse CI 里 `/hike/sample-route/` 连续失败，逐 URL 分数显示
 * perf 68 / **LCP 3.82 s**（预算 3.5 s），而 LCP 元素就是 Leaflet 的瓦片图。
 * 一张"可以点开"的地图不该让首屏等第三方瓦片，也不该每开一次页面就给
 * openstreetmap.org 发一串请求。
 *
 * 现在：先画内联 SVG 轨迹预览，点「加载交互地图」才水合 Leaflet。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { trackPreview } from "../src/lib/gpx-preview";

const POINTS = [
  { lat: 40.5, lng: 115.8 },
  { lat: 40.55, lng: 115.86 },
  { lat: 40.6, lng: 115.9 },
];

test("轨迹投影成 SVG 路径：起终点在画布内、路径以 M 开头", () => {
  const preview = trackPreview(POINTS, { width: 640, height: 360, padding: 24 });
  assert.ok(preview, "三个点应当能画出轨迹");
  assert.match(preview!.path, /^M[\d.]+ [\d.]+ L/);
  for (const point of [preview!.start, preview!.end]) {
    assert.ok(point.x >= 24 && point.x <= 616, `x 越界：${point.x}`);
    assert.ok(point.y >= 24 && point.y <= 336, `y 越界：${point.y}`);
  }
});

test("等比缩放：短边居中，不把轨迹拉扁", () => {
  // 南北向 0.1°、东西向 0.001°（很扁的轨迹）——等比缩放后 y 跨度应明显大于 x 跨度
  const tall = trackPreview([{ lat: 40.0, lng: 115.8 }, { lat: 40.1, lng: 115.801 }])!;
  const dy = Math.abs(tall.end.y - tall.start.y);
  const dx = Math.abs(tall.end.x - tall.start.x);
  const ratio = dy / dx;
  const rawRatio = 0.1 / (0.001 * Math.cos((40.05 * Math.PI) / 180));
  assert.ok(Math.abs(ratio - rawRatio) / rawRatio < 0.05, `纵横比失真：${ratio.toFixed(1)} vs ${rawRatio.toFixed(1)}`);
});

test("点不够或非法坐标返回 null（没轨迹就不画）", () => {
  assert.equal(trackPreview([]), null);
  assert.equal(trackPreview([{ lat: 40, lng: 115 }]), null);
  assert.equal(trackPreview([{ lat: Number.NaN, lng: 1 }, { lat: 1, lng: 2 }]), null);
});

test("组件默认走静态预览，Leaflet 只在点击后加载", async () => {
  const src = await readFile(new URL("../src/components/GpxMap.tsx", import.meta.url), "utf8");
  assert.match(src, /useState\(false\)/, "应当有一个「未激活」状态");
  assert.match(src, /加载交互地图/, "缺少切换按钮文案");
  assert.match(src, /data-gpx-map="preview"/);
  assert.match(src, /data-gpx-map="leaflet"/);
  // tileLayer 必须在 active 之后（effect 依赖里带 active），不能无条件执行
  assert.match(src, /\[active, points\]/, "effect 没有依赖 active，地图会一进视口就加载");
});

test("探针要先点按钮再看地图（否则永远找不到 .leaflet-container）", async () => {
  const probe = await readFile(new URL("../scripts/inp-probe.mjs", import.meta.url), "utf8");
  const clickIdx = probe.indexOf("加载交互地图");
  const mapIdx = probe.indexOf('.leaflet-container');
  assert.ok(clickIdx !== -1 && mapIdx !== -1, "探针缺少点击或地图定位");
  assert.ok(clickIdx < mapIdx, "要点按钮在前，找地图在后");
});
