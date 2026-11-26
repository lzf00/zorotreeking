/**
 * 自动生成的内容必须在页面上说出来（第 210 轮）。
 *
 * 线上实测（2026-11-26）：193 篇 AI 日报 + 23 篇周报的正文**没有一句**说明，
 * 读者只能从一个标签 chip「auto」猜；同时 JSON-LD 里 author 一律是
 * `Person: Zifei Liu` —— 机器整理的文字被标成个人署名。
 *
 * 判定只认结构（路径 / 标签），不猜正文措辞；说法固定，模板直接用。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { AUTO_RULES, autoDisclosure, autoKindOfPath, autoKindOfPost } from "../src/lib/auto-content";
import { AUTO_PREFIXES, disclosureKind, hasContributor, isAutoPage, judge } from "../scripts/check-auto-disclosure.mjs";

const read = (rel: string) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");

test("按路径认出三类自动内容（中英各一套前缀）", () => {
  assert.equal(autoKindOfPath("/ai/digest-2026-11-25/"), "digest");
  assert.equal(autoKindOfPath("/en/ai/digest-2026-11-25/"), "digest");
  assert.equal(autoKindOfPath("/invest/digest-2026-11-25/"), "digest");
  assert.equal(autoKindOfPath("/invest/market-recap-2026-11-25/"), "recap");
  assert.equal(autoKindOfPath("/en/invest/market-recap-2026-11-25/"), "recap");
  assert.equal(autoKindOfPath("/ai/weekly-2026-W46/"), "weekly");
});

test("人写的内容一律不算自动产出", () => {
  for (const p of ["/ai/hello-world/", "/invest/2026-04-review/", "/photo/baokemeng/",
                   "/hike/travel/ali-grand-loop-2026/", "/ai/digest/", "/", "/en/"]) {
    assert.equal(autoKindOfPath(p), null, p);
  }
});

test("按 frontmatter 判定与按路径判定结论一致", () => {
  assert.equal(autoKindOfPost({ translationKey: "digest-2026-11-25", tags: ["digest", "auto"] }), "digest");
  assert.equal(autoKindOfPost({ translationKey: "weekly-2026-W46", tags: ["weekly", "auto"] }), "weekly");
  // 复盘的 tag 是 market-recap/wind/daily，没有 digest —— 第 206 轮就是漏了这个
  assert.equal(autoKindOfPost({ translationKey: "market-recap-2026-11-25", tags: ["market-recap"] }), "recap");
  assert.equal(autoKindOfPost({ translationKey: "hello-world", tags: ["essay"] }), null);
});

test("说法是固定的一句话，中英都不含内部实现细节", () => {
  for (const kind of ["digest", "recap", "weekly"] as const) {
    const zh = autoDisclosure(kind, "zh");
    const en = autoDisclosure(kind, "en");
    assert.ok(zh.text.length > 20 && zh.label, kind);
    assert.match(zh.text, /不是人工撰写|自动/, `${kind} 中文没说清是机器产出`);
    assert.ok(!/[\u4e00-\u9fff]/.test(en.text), `${kind} 英文页混了中文`);
    assert.match(en.text, /not written by hand|script|generated/i, `${kind} 英文没说清`);
  }
  assert.notEqual(autoDisclosure("digest", "zh").text, autoDisclosure("recap", "zh").text, "日报与复盘不能共用一句");
});

test("闸门脚本的前缀清单和源码规则不许各写一份、各漂一边", async () => {
  const scriptPrefixes = [...AUTO_PREFIXES].sort();
  const sourcePrefixes = AUTO_RULES.map((r: { prefix: string }) => r.prefix).sort();
  assert.deepEqual(scriptPrefixes, sourcePrefixes);
});

test("judge：漏声明、以及反过来把人的内容标成机器产出，都要报", () => {
  const ok = {
    route: "/ai/digest-2026-11-25/",
    html:
      '<p data-auto-disclosure="digest" data-pagefind-ignore></p>' +
      '<script type="application/ld+json">{"@type":"Article","contributor":{}}</script>',
  };
  assert.deepEqual(judge([ok]), []);

  // 声明在，但没排除索引 → 单独报一条
  const indexed = judge([
    { route: "/ai/digest-2026-11-25/", html: '<p data-auto-disclosure="digest"></p><script type="application/ld+json">{"@type":"Article","contributor":{}}</script>' },
  ]);
  assert.equal(indexed.length, 1);
  assert.match(indexed[0].problem, /搜索索引/);

  const missing = judge([{ route: "/ai/digest-2026-11-25/", html: "<p>没有声明</p>" }]);
  assert.equal(missing.length, 2, "既缺声明也缺 contributor");

  const handwritten = judge([{ route: "/ai/hello-world/", html: '<p data-auto-disclosure="digest"></p>' }]);
  assert.equal(handwritten.length, 1);
  assert.match(handwritten[0].problem, /人写的内容被标成自动生成/);
});

test("判定函数本身能读真实 HTML 片段", () => {
  assert.equal(isAutoPage("/en/invest/market-recap-2026-11-25/"), true);
  assert.equal(isAutoPage("/invest/2026-04-review/"), false);
  assert.equal(disclosureKind('<p data-auto-disclosure="recap">'), "recap");
  assert.equal(disclosureKind("<p>无</p>"), null);
  assert.equal(hasContributor('<script type="application/ld+json">{"@type":"Article","contributor":{"@type":"Organization"}}</script>'), true);
  assert.equal(hasContributor('<script type="application/ld+json">{"@type":"Article"}</script>'), false);
});

test("四个文章模板（中英 × AI/投资）都挂了声明组件", async () => {
  for (const rel of ["src/pages/ai/[slug].astro", "src/pages/en/ai/[slug].astro",
                     "src/pages/invest/[slug].astro", "src/pages/en/invest/[slug].astro"]) {
    const src = await read(rel);
    assert.match(src, /AutoDisclosure/, `${rel} 没挂声明组件`);
    assert.match(src, /autoKindOfPost/, `${rel} 没做自动内容判定`);
  }
});

test("BaseLayout 给自动页面加 contributor，但不改作者（人是发布者）", async () => {
  const src = await read("src/layouts/BaseLayout.astro");
  assert.match(src, /autoKindOfPath/);
  assert.match(src, /contributor: autoContributor/);
  assert.match(src, /name: "Zifei Liu"/, "作者仍是站长：他对发布负责");
});

test("声明块不进搜索索引（第 212 轮：样板文字会把命中片段挤成免责声明）", async () => {
  const { disclosureIsIgnored } = await import("../scripts/check-auto-disclosure.mjs");
  const html = '<p data-auto-disclosure="digest" data-pagefind-ignore class="x">…</p>';
  assert.equal(disclosureIsIgnored(html), true);
  assert.equal(disclosureIsIgnored('<p data-auto-disclosure="digest">…</p>'), false);
  assert.equal(disclosureIsIgnored("<p>没有声明</p>"), null);

  // 组件源码里必须有这个属性，否则下一版构建会静默把样板塞回索引
  const component = await read("src/components/AutoDisclosure.astro");
  assert.match(component, /data-pagefind-ignore/);
});
