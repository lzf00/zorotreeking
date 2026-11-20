#!/usr/bin/env node
/**
 * Feed 自检：dist/rss.xml + dist/atom.xml。
 *
 * 为什么需要它：feed 是「整份重传」的格式，坏了没人会立刻发现——阅读器只是默默不再更新。
 * 第 57 轮审计发现 RSS 缺 `atom:link rel="self"`、缺 `lastBuildDate`，而且一次吐 526 条
 * （260 KB）；这些都属于「结构性问题」，用 XML 解析器 + 必填项检查最省事。
 *
 * 检查项：
 *   RSS   channel 必填 title/link/description/language/lastBuildDate/ttl
 *         必须有 <atom:link rel="self">（聚合器靠它认规范地址）
 *         每个 item：title、link、guid、pubDate 可解析、link 是本站绝对 URL、guid 与 link 一致
 *         条数 ≤ 100（超过 100 条的 feed 阅读器解析慢、每次刷新都在重传历史）
 *   Atom  feed 必填 id/title/updated/author、link rel=self
 *         每个 entry：id、title、updated 可解析
 *   共同  时间必须倒序（最新在前）；同一 feed 内 guid/id 不得重复
 *
 * 用法：node scripts/check-feeds.mjs [--dist dist] [--limit 5]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const ARGS = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = ARGS.indexOf(name);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : fallback;
};
const DIST = path.resolve(argOf("--dist", "dist"));
const LIMIT = Number(argOf("--limit", "5"));

const problems = [];
const fail = (feed, msg) => problems.push(`[${feed}] ${msg}`);

/** 极简 XML 提取：feed 是我们自己生成的，结构稳定，不引第三方 parser */
function tags(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1].trim());
}
function attrOf(xml, tagPattern, attr) {
  const m = xml.match(tagPattern);
  return m ? (m[0].match(new RegExp(`${attr}="([^"]*)"`))?.[1] ?? null) : null;
}
const unescape = (s) =>
  s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) =>
    ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" })[m],
  );

const parseDate = (v) => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

function checkRss(xml) {
  const channel = xml.match(/<channel>([\s\S]*)<\/channel>/)?.[1];
  if (!channel) return fail("rss", "没有 <channel>");

  for (const field of ["title", "link", "description", "language", "lastBuildDate", "ttl"]) {
    if (!tags(channel, field).length) fail("rss", `channel 缺 <${field}>`);
  }
  if (tags(channel, "lastBuildDate").length && parseDate(tags(channel, "lastBuildDate")[0]) === null) {
    fail("rss", `channel/lastBuildDate 不能解析：${tags(channel, "lastBuildDate")[0]}`);
  }
  const selfLink = channel.match(/<atom:link[^>]*rel="self"[^>]*>/);
  if (!selfLink) fail("rss", '缺 <atom:link rel="self">（聚合器认不出规范地址）');
  else {
    const href = selfLink[0].match(/href="([^"]*)"/)?.[1];
    const type = selfLink[0].match(/type="([^"]*)"/)?.[1];
    if (!href || !/^https?:\/\//.test(href)) fail("rss", `atom:link self 不是绝对 URL：${href}`);
    if (type !== "application/rss+xml") fail("rss", `atom:link self type 应为 application/rss+xml，实际 ${type}`);
  }

  const items = [...channel.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  if (items.length === 0) fail("rss", "没有任何 <item>");
  if (items.length > 100) fail("rss", `条目 ${items.length} 条（>100，阅读器每次都要整份重传）`);

  const siteOrigin = tags(channel, "link")[0] ?? "";
  const seen = new Set();
  let prev = Infinity;
  for (const [i, item] of items.entries()) {
    for (const field of ["title", "link", "guid", "pubDate"]) {
      if (!tags(item, field).length) fail("rss", `第 ${i + 1} 条缺 <${field}>`);
    }
    const link = unescape(tags(item, "link")[0] ?? "");
    const guid = unescape(tags(item, "guid")[0] ?? "");
    if (link && !link.startsWith(siteOrigin)) fail("rss", `第 ${i + 1} 条 link 不是本站：${link}`);
    if (link && guid && link !== guid) fail("rss", `第 ${i + 1} 条 guid 与 link 不一致：${guid} vs ${link}`);
    if (guid) {
      if (seen.has(guid)) fail("rss", `guid 重复：${guid}`);
      seen.add(guid);
    }
    const t = parseDate(tags(item, "pubDate")[0] ?? "");
    if (t === null) fail("rss", `第 ${i + 1} 条 pubDate 不能解析：${tags(item, "pubDate")[0]}`);
    else if (t > prev) fail("rss", `第 ${i + 1} 条时间比上一条新（应按时间倒序）`);
    else prev = t;
  }
  return items.length;
}

function checkAtom(xml) {
  const head = xml.match(/<feed[\s\S]*?(?=<entry>)/)?.[0] ?? xml;
  for (const field of ["title", "updated", "id"]) {
    if (!tags(head, field).length) fail("atom", `feed 缺 <${field}>`);
  }
  if (!/<author>/.test(head)) fail("atom", "feed 缺 <author>");
  if (!/<link[^>]*rel="self"/.test(head)) fail("atom", 'feed 缺 <link rel="self">');
  const updated = tags(head, "updated")[0];
  if (updated && parseDate(updated) === null) fail("atom", `feed updated 不能解析：${updated}`);

  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  if (entries.length === 0) fail("atom", "没有任何 <entry>");
  const seen = new Set();
  let prev = Infinity;
  for (const [i, entry] of entries.entries()) {
    for (const field of ["id", "title", "updated"]) {
      if (!tags(entry, field).length) fail("atom", `第 ${i + 1} 条缺 <${field}>`);
    }
    const id = unescape(tags(entry, "id")[0] ?? "");
    if (id) {
      if (seen.has(id)) fail("atom", `entry id 重复：${id}`);
      seen.add(id);
    }
    const t = parseDate(tags(entry, "updated")[0] ?? "");
    if (t === null) fail("atom", `第 ${i + 1} 条 updated 不能解析`);
    else if (t > prev) fail("atom", `第 ${i + 1} 条时间比上一条新（应按时间倒序）`);
    else prev = t;
  }
  return entries.length;
}

const feeds = [
  ["rss", path.join(DIST, "rss.xml")],
  ["atom", path.join(DIST, "atom.xml")],
];
const counts = {};
for (const [name, file] of feeds) {
  let xml;
  try {
    xml = await readFile(file, "utf8");
  } catch {
    fail(name, `找不到 ${file}（先 npm run build）`);
    continue;
  }
  counts[name] = name === "rss" ? checkRss(xml) : checkAtom(xml);
}

if (problems.length) {
  console.error(`✗ Feed 自检失败（${problems.length} 个问题）：`);
  for (const p of problems.slice(0, LIMIT * 4)) console.error(`  ${p}`);
  if (problems.length > LIMIT * 4) console.error(`  …还有 ${problems.length - LIMIT * 4} 条`);
  process.exit(1);
}
console.log(
  `✓ Feed 自检通过：rss ${counts.rss} 条、atom ${counts.atom} 条；` +
    `channel/feed 必填项齐全，时间倒序，guid 无重复`,
);
