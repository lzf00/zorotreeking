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
