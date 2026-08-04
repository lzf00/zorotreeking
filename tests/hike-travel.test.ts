import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  const [section, component] = await Promise.all([
    readFile(new URL("../src/pages/hike/index.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/components/travel/AliGrandLoopGuide.astro", import.meta.url), "utf8"),
  ]);

  assert.match(section, /<AliGrandLoopGuide \/>/);
  assert.match(section, /id="travel-guide-ali"/);
  assert.doesNotMatch(section, /打开完整攻略/);
  assert.match(component, /guideMain/);
  assert.match(component, /data-ali-guide/);
  assert.match(component, /@scope \(\.ali-guide\)/);
});
