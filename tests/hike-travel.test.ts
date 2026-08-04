import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { aliRoadLabels, aliRoutedDayGeometry } from "../src/data/ali-road-geometry";
import { aliRouteDays, aliRoutePoints } from "../src/data/ali-route";
import { getTravelGuides } from "../src/data/travel-guides";
import { wgs84ToGcj02 } from "../src/utils/amap-coordinate";

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
  assert.match(atlas, /高德地图优先/);
  assert.match(atlas, /OpenStreetMap 自动备用/);
  assert.match(atlas, /公路走向/);
  assert.match(atlas, /道路拟合/);
  assert.match(atlas, /逐日道路、节点、补给与退出条件/);
  assert.match(map, /tile\.openstreetmap\.org/);
  assert.match(map, /OpenStreetMap contributors/);
  assert.match(map, /webapi\.amap\.com\/maps\?v=2\.0/);
  assert.match(map, /PUBLIC_AMAP_JS_KEY/);
  assert.match(map, /PUBLIC_AMAP_SECURITY_CODE/);
  assert.match(map, /data-map-provider/);
  assert.match(map, /aliRoutedDayGeometry/);
  assert.match(map, /公路走向与编号/);
  assert.match(map, /control\.scale/);
  assert.match(map, /scrollWheelZoom: false/);
});

test("AMap integration uses encrypted deployment secrets and a tested coordinate conversion", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(workflow, /PUBLIC_AMAP_JS_KEY: \$\{\{ secrets\.PUBLIC_AMAP_JS_KEY \}\}/);
  assert.match(workflow, /PUBLIC_AMAP_SECURITY_CODE: \$\{\{ secrets\.PUBLIC_AMAP_SECURITY_CODE \}\}/);
  assert.match(workflow, /Verify AMap build configuration/);
  assert.match(workflow, /Reconcile AMap CSP allowlist/);
  assert.match(workflow, /https:\/\/webapi\.amap\.com/);
  assert.match(workflow, /https:\/\/restapi\.amap\.com/);
  assert.match(workflow, /https:\/\/jsapi-service\.amap\.com/);
  assert.match(workflow, /https:\/\/\*\.amap\.com/);
  assert.match(workflow, /AMap CSP allowlist missing from production response/);
  assert.doesNotMatch(workflow, /\b[0-9a-f]{32}\b/i, "workflow must not contain a literal AMap credential");

  const [shanghaiLat, shanghaiLng] = wgs84ToGcj02(31.2304, 121.4737);
  assert.ok(shanghaiLat > 31.228 && shanghaiLat < 31.231);
  assert.ok(shanghaiLng > 121.477 && shanghaiLng < 121.479);

  const [lhasaLat, lhasaLng] = wgs84ToGcj02(29.652, 91.1721);
  assert.ok(lhasaLat > 29.648 && lhasaLat < 29.654);
  assert.ok(lhasaLng > 91.173 && lhasaLng < 91.177);

  assert.deepEqual(wgs84ToGcj02(51.5074, -0.1278), [51.5074, -0.1278]);
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

test("Ali road overlay follows routed geometry and labels every major highway", () => {
  assert.deepEqual(
    Object.keys(aliRoutedDayGeometry).map(Number),
    Array.from({ length: 13 }, (_, index) => index + 1),
  );

  let coordinateCount = 0;
  for (const day of aliRouteDays) {
    const coordinates = aliRoutedDayGeometry[day.day];
    assert.ok(coordinates && coordinates.length >= 2, `D${day.day} needs road-following geometry`);
    coordinateCount += coordinates.length;
    for (const [lat, lng] of coordinates) {
      assert.ok(lat >= 27 && lat <= 34, `D${day.day} road latitude is outside the route region`);
      assert.ok(lng >= 79 && lng <= 92, `D${day.day} road longitude is outside the route region`);
    }
  }
  assert.ok(coordinateCount >= 1_000, "road overlay must retain enough detail to show road curvature");

  const roadRefs = new Set(aliRoadLabels.map((road) => road.ref));
  for (const expected of ["G109", "G219", "G317", "G318", "G349", "G565"]) {
    assert.ok(roadRefs.has(expected), `${expected} needs a visible road shield`);
  }
  for (const road of aliRoadLabels) {
    assert.ok(road.days.length > 0);
    assert.ok(road.description.length >= 15);
    assert.ok(road.lat >= 27 && road.lat <= 34);
    assert.ok(road.lng >= 79 && road.lng <= 92);
  }
});
