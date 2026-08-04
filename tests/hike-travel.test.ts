import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { aliRouteDays, aliRoutePoints } from "../src/data/ali-route";
import { getTravelGuides } from "../src/data/travel-guides";

test("hike section is presented as hiking and travel across navigation and home", async () => {
  const [ui, home, section] = await Promise.all([
    readFile(new URL("../src/i18n/ui.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/index.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/hike/index.astro", import.meta.url), "utf8"),
  ]);

  assert.match(ui, /"nav\.hike": "徒步旅行"/);
  assert.match(ui, /"section\.hike\.desc": "徒步路线、旅行攻略与沿途风景"/);
  assert.match(home, /hikes\.length \+ travelPosts\.length/);
  assert.match(section, />旅行攻略/);
  assert.match(section, />徒步路线</);
});

test("Ali travel guide is indexed and keeps its complete standalone roadbook", async () => {
  const guides = getTravelGuides("zh");
  assert.equal(guides.length, 1);
  assert.equal(guides[0]?.slug, "ali-grand-loop-2026");
  assert.equal(guides[0]?.href, "/hike/travel/ali-grand-loop-2026/");

  const html = await readFile(
    new URL("../public/hike/travel/ali-grand-loop-2026/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /<title>向西 · 阿里大环线 2026<\/title>/);
  assert.match(html, /返回徒步旅行板块/);
  assert.match(html, /id="itinerary"/);
  assert.match(html, /id="roadbook"/);
  assert.match(html, /id="permit"/);
  assert.match(html, /id="budget"/);
  assert.match(html, /沪公网安备31011502406842号/);
  assert.doesNotMatch(html, /target="_blank" rel="noreferrer"/);
});

test("the complete Ali roadbook is embedded directly in the hike landing page", async () => {
  const [section, component, atlas, map] = await Promise.all([
    readFile(new URL("../src/pages/hike/index.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/components/travel/AliGrandLoopGuide.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/components/travel/AliRouteOverview.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/components/travel/AliRouteMap.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(section, /<AliGrandLoopGuide \/>/);
  assert.match(section, /id="travel-guide-ali"/);
  assert.doesNotMatch(section, /打开完整攻略/);
  assert.match(component, /guideMain/);
  assert.match(component, /data-ali-guide/);
  assert.match(component, /@scope \(\.ali-guide\)/);
  assert.match(component, /<AliRouteOverview \/>/);
  assert.match(component, /route-atlas/);
  assert.match(component, /map-panel reveal/);
  assert.match(atlas, /OpenStreetMap 真实底图/);
  assert.match(atlas, /逐日道路、节点、补给与退出条件/);
  assert.match(map, /tile\.openstreetmap\.org/);
  assert.match(map, /OpenStreetMap contributors/);
  assert.match(map, /scrollWheelZoom: false/);
});

test("Ali route atlas has complete, internally consistent day and marker data", () => {
  assert.equal(aliRouteDays.length, 13);
  assert.ok(aliRoutePoints.length >= 35);

  const pointIds = aliRoutePoints.map((point) => point.id);
  assert.equal(new Set(pointIds).size, pointIds.length, "route point IDs must be unique");

  const knownIds = new Set(pointIds);
  for (const point of aliRoutePoints) {
    assert.ok(point.lat >= 27 && point.lat <= 34, `${point.id} latitude is outside the route region`);
    assert.ok(point.lng >= 79 && point.lng <= 92, `${point.id} longitude is outside the route region`);
    assert.ok(point.name.length > 1);
    assert.ok(point.detail.length >= 20, `${point.id} needs a useful map description`);
  }

  for (const [index, day] of aliRouteDays.entries()) {
    assert.equal(day.day, index + 1);
    assert.ok(day.pointIds.length >= 2, `D${day.day} needs at least two map nodes`);
    assert.ok(day.distance.length > 0 && day.driving.length > 0 && day.roads.length > 0);
    assert.ok(day.highlights.length >= 2);
    assert.ok(day.supply.length >= 20 && day.risk.length >= 20 && day.decision.length >= 20);
    for (const pointId of day.pointIds) {
      assert.ok(knownIds.has(pointId), `D${day.day} references unknown point ${pointId}`);
    }
  }

  const markerKinds = new Set(aliRoutePoints.map((point) => point.kind));
  assert.deepEqual(
    markerKinds,
    new Set(["airport", "overnight", "city", "attraction", "viewpoint", "supply"]),
  );
});
