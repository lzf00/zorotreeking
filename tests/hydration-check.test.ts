import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SCRIPT = new URL("../scripts/check-hydration.mjs", import.meta.url);
const PKG = new URL("../package.json", import.meta.url);

test("水合检查要能跨时段复现（SSR 里有时钟文案时会报 #418）", async () => {
  const src = await readFile(SCRIPT, "utf8");
  assert.match(src, /--cross-time/);
  assert.match(src, /2026-11-20T04:00:00Z/, "要有一个「窗口内」的假时钟");
  assert.match(src, /2026-11-21T04:00:00Z/, "要有一个「周末」的假时钟");
  assert.match(src, /FakeDate/);
  assert.match(src, /process\.exit\(1\)/);
});

test("水合检查自己起服务器，所以能直接进 gate", async () => {
  const src = await readFile(SCRIPT, "utf8");
  assert.match(src, /serveDist/);
  assert.match(src, /server\?\.close\(\)/);
});

test("gate 里水合检查跑在 build 之后、且带 --cross-time", async () => {
  const pkg = JSON.parse(await readFile(PKG, "utf8")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["check:hydration"], /--cross-time/);
  assert.ok(pkg.scripts.gate.includes("check:hydration"), "gate 要跑水合检查");
  assert.ok(
    pkg.scripts.gate.indexOf("npm run build") < pkg.scripts.gate.indexOf("check:hydration"),
    "必须 build 之后再水合",
  );
});
