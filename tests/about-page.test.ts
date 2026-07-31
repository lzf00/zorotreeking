import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { aboutData } from "../src/data/about";

const sectionMarkers = [
  "NOW",
  "STACK",
  "PROJECTS",
  "READS",
  "NORTH STAR",
  "TIMELINE",
  "CONNECT",
  "<ContentPulse />",
];

test("about pages preserve the original profile layout", async () => {
  const pages = await Promise.all([
    readFile("src/pages/about.astro", "utf8"),
    readFile("src/pages/en/about.astro", "utf8"),
  ]);

  for (const source of pages) {
    for (const marker of sectionMarkers) {
      assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
});

test("about profile keeps generalized experience without identifying details", () => {
  const profile = aboutData as unknown as {
    zh: { name: string; intro: string; timeline: Array<{ label: string; what: string }> };
    en: { name: string; intro: string; timeline: Array<{ label: string; what: string }> };
  };
  const serialized = JSON.stringify(profile);

  assert.equal(profile.zh.name, "Zoro");
  assert.equal(profile.en.name, "Zoro");
  assert.match(serialized, /NLP/);
  assert.match(serialized, /知识图谱|Knowledge Graph/);
  assert.match(serialized, /Agent/);

  assert.doesNotMatch(serialized, /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  assert.doesNotMatch(serialized, /\b(?:19|20)\d{2}\b/);
  assert.doesNotMatch(serialized, /大学|学院|公司|University|College|Company/);
  assert.doesNotMatch(serialized, /\d+\s*(?:万|亿|million|billion)\+?/i);
});
