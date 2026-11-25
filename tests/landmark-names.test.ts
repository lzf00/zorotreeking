/**
 * landmark 必须有可区分的名字（第 193 轮）。
 *
 * 事故：把 a11y 巡检从「手写路径表」改成「从构建产物反推模板、每个模板测首末页」之后，
 * 第一次跑就抓到 8 条此前从没测过的违规 —— `/changelog/` 上下两个分页 <nav> 用了同一个
 * `aria-label`；8 个行程攻略页里 3–6 个 `<aside>` 全是无名 complementary landmark
 * （axe `landmark-unique`，moderate）。
 *
 * 这类问题人和截图都看不出来：视觉完全正常，只有读屏的 landmark 列表里是一串"aside、aside、aside"。
 * 所以钉在源码层：新增 aside/nav 必须给名字，且同一页内不重复。
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("行程攻略页的 aside 都带 aria-label（无名 complementary landmark 会互相淹没）", async () => {
  const dir = new URL("../src/components/travel/", import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".astro"));
  const offenders: string[] = [];
  for (const name of files) {
    const src = await read(`src/components/travel/${name}`);
    for (const match of src.matchAll(/<aside\b([^>]*)>/g)) {
      if (!/aria-label=/.test(match[1])) offenders.push(`${name}: <aside${match[1].slice(0, 40)}>`);
    }
  }
  assert.deepEqual(offenders, [], `这些 aside 没有可读名字：\n${offenders.join("\n")}`);
});

test("行程攻略页里的 landmark 名字在同一页内不重复", async () => {
  const dir = new URL("../src/components/travel/", import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".astro"));
  const seen = new Map<string, string[]>();
  for (const name of files) {
    const src = await read(`src/components/travel/${name}`);
    for (const match of src.matchAll(/aria-label="([^"]+)"/g)) {
      const list = seen.get(match[1]);
      if (list) list.push(name);
      else seen.set(match[1], [name]);
    }
  }
  // 同一个组件里重复才算问题；不同页面各自用一个名字是正常的
  const offenders = [...seen.entries()].filter(([, names]) => new Set(names).size !== names.length);
  assert.deepEqual(offenders.map(([label]) => label), [], `同一组件内重复的 landmark 名字：${offenders.map(([l, n]) => `${l} (${n.join(",")})`).join("; ")}`);
});

test("/changelog/ 上下两个分页 nav 名字不同", async () => {
  const src = await read("src/pages/changelog/[...page].astro");
  const labels = [...src.matchAll(/aria-label="([^"]*分页[^"]*)"/g)].map((m) => m[1]);
  assert.equal(labels.length, 2, "changelog 有上下两个分页 nav");
  assert.notEqual(labels[0], labels[1], "两个 nav 同名会被 axe 判 landmark-unique");
});

test("订阅 CTA 的 aside 有名，且名字按语言取（它会出现在英文页里）", async () => {
  const src = await read("src/components/SubscribeCTA.astro");
  // 第 193 轮的真实回归：我最初写死 aria-label="订阅"，结果 536 个英文页带着中文属性上线前被
  // check:i18n-leaks 抓住。属性文案必须走组件里的 t() 或 lang 分支。
  assert.match(src, /aria-label=\{t\(/, "SubscribeCTA 的 aside 名字要按 lang 取值，不能写死中文");
  assert.doesNotMatch(src, /aria-label="[\u4e00-\u9fa5]/, "不许把中文写进 aria-label 字面量");
});
