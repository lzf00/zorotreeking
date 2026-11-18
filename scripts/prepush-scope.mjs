#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// pre-push 该跑多重的检查？
//
// 2026-11-18 出过一次事故：订阅页加了个指向 /en/explore/ 的链接，而那个页面只有中文版。
// `check:seo` 判它「打不开的站内链接」并 exit 1，但本地是用 `... | tail -2` 看输出的，
// 摘要行写着「通过」就当成过了，坏链接直接推上去，部署连红四次、生产停更 50 分钟。
//
// 所以推之前至少要跑「构建 + 这两道内容门禁」。但每次 10 分钟的完整 gate 也不现实，
// 于是按改动范围分档：
//   fast —— 只动了内容/生成数据：跑单元测试 + 类型检查（几十秒），页面结构不可能因此变；
//   full —— 动了模板/样式/脚本/配置：必须重新构建，再跑 check:og / check:seo（约 2 分钟）。
const CONTENT_ONLY_PATHS = [
  /^src\/data\/(etf-three-factor-|wind-|us-market)/,
  /^src\/content\//,
  /^public\/photos\//,
];

export function prepushScope(paths) {
  const changed = paths.map((path) => path.trim()).filter(Boolean);
  // 判断不了改了什么（取不到 diff）时按最重的处理
  if (changed.length === 0) return "full";
  return changed.some((path) => !CONTENT_ONLY_PATHS.some((pattern) => pattern.test(path))) ? "full" : "fast";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${prepushScope(readFileSync(0, "utf8").split("\n"))}\n`);
}
