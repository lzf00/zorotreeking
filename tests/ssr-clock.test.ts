import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SCRIPT = new URL("../scripts/check-ssr-clock.mjs", import.meta.url);
const HOLDINGS = new URL("../src/components/LiveHoldings.tsx", import.meta.url);
const ETF = new URL("../src/components/EtfLiveTurnover.tsx", import.meta.url);
const PKG = new URL("../package.json", import.meta.url);

test("SSR 时钟文案检查收的是「时钟推导」的文案，并给出改法", async () => {
  const src = await readFile(SCRIPT, "utf8");
  assert.match(src, /净值发布窗口/);
  assert.match(src, /（未开盘）/);
  assert.match(src, /mounted/, "报错信息要指向挂载后再渲染");
  assert.match(src, /process\.exit\(1\)/);
});

test("两个实时组件都把时钟文案挡在挂载之后", async () => {
  for (const [name, url] of [
    ["LiveHoldings", HOLDINGS],
    ["EtfLiveTurnover", ETF],
  ] as const) {
    const src = await readFile(url, "utf8");
    assert.match(src, /const \[mounted, setMounted\] = useState\(false\)/, `${name} 要有 mounted 状态`);
    assert.match(src, /useEffect\(\(\) => setMounted\(true\), \[\]\)/, `${name} 要在挂载后 setMounted`);
    assert.match(src, /mounted &&/, `${name} 的时钟文案要用 mounted 包住`);
  }
});

test("门禁里有 check:ssr-clock（静态扫描，跑在 build 之后）", async () => {
  const pkg = JSON.parse(await readFile(PKG, "utf8")) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts["check:ssr-clock"], "要有独立脚本");
  assert.match(pkg.scripts.gate, /check:ssr-clock/, "gate 要跑它");
  assert.ok(
    pkg.scripts.gate.indexOf("npm run build") < pkg.scripts.gate.indexOf("check:ssr-clock"),
    "必须 build 之后再扫 HTML",
  );
});

test("「（非今日）」进了 SSR 黑名单，而且有跨天动态场景兜底（第 216 轮）", async () => {
  const script = await readFile(new URL("../scripts/check-ssr-clock.mjs", import.meta.url), "utf8");
  assert.match(script, /（非今日）/, "新鲜度后缀必须进黑名单，否则又会被写回 SSR");

  const smoke = await readFile(new URL("../scripts/check-interactions.mjs", import.meta.url), "utf8");
  assert.match(smoke, /跨天访问：行情页都不许 hydration 报错/, "要有跨天访问的动态场景");
  for (const route of ["/invest/", "/invest/etf/", "/invest/us-market/"]) {
    assert.ok(smoke.includes(`"${route}"`), `跨天场景要覆盖 ${route}`);
  }
  assert.match(smoke, /10 \* 24 \* 3600 \* 1000/, "场景要真的把时钟拨走");
});

test("美股页也不在渲染里读时钟（第 216 轮：它当时每次跨天访问都抛 #418）", async () => {
  const src = await readFile(new URL("../src/components/UsMarketDashboard.tsx", import.meta.url), "utf8");
  // 只允许在挂载时取一次 now；渲染路径里出现 Date.now() 就会 SSR/client 不一致
  const clockReads = src.match(/Date\.now\(\)/g) ?? [];
  assert.equal(clockReads.length, 1, `Date.now() 只该出现一次（挂载时），现在 ${clockReads.length} 次`);
  assert.match(src, /useEffect\(\(\) => setNowMs\(Date\.now\(\)\), \[\]\)/, "要在挂载后取一次当前时间");
  assert.match(src, /nowMs === null/, "首帧要走与时钟无关的分支");
  // 相对时间函数必须能接受外部 now（不再自己取时钟）
  assert.match(src, /function formatQuoteTime\([\s\S]{0,120}nowMs: number \| null\)/, "formatQuoteTime 要接 now");
  assert.ok(!/describeSnapshot\([^)]*\)\.text/.test(src.replace(/nowMs === null \?[\s\S]{0,120}?\n/g, "")), "不要在渲染里直接调 describeSnapshot 不传 now");
});

test("黑名单的例外是「静态文档正文」，不是「让渲染读时钟」（第 216 轮）", async () => {
  const src = await readFile(new URL("../scripts/check-ssr-clock.mjs", import.meta.url), "utf8");
  const allow = /const ALLOW = \[([\s\S]*?)\];/.exec(src)?.[1] ?? "";
  for (const [frag, why] of [["changelog/index.html", "更新日志"], ["now/index.html", "「现在」页"]]) {
    assert.ok(allow.includes(frag), `${why} 的例外要登记`);
  }
  // 例外只能登记「整页 + 具体文案」，不能写成空文案（那等于关掉这项检查）
  for (const line of allow.split("\n").filter((l) => l.trim().startsWith("["))) {
    assert.ok(line.includes("（非今日）"), `例外必须写明具体文案：${line.trim()}`);
  }
});
