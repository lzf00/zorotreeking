import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const SCRIPT = new URL("../scripts/check-internal-links.mjs", import.meta.url).pathname;
const ROOT = new URL("..", import.meta.url).pathname;

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "linkcheck-"));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return dir;
}

function run(dist: string, extra: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, "--dist", dist, ...extra], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

test("链接都在磁盘上时通过", async () => {
  const dist = await fixture({
    "index.html": '<a href="/photo/a/">相册</a><a href="/">首页</a><img src="/x.png">',
    "photo/a/index.html": '<a href="/">回首页</a>',
    "x.png": "png",
  });
  const r = run(dist);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /站内链接自检通过/);
});

test("断链会被抓出来并返回非零", async () => {
  const dist = await fixture({
    "index.html": '<a href="/photo/missing/">坏链</a>',
  });
  const r = run(dist);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /站内链接/);
  assert.match(r.stdout, /\/photo\/missing\//);
});

test("缺失的图片/脚本也算断链", async () => {
  const dist = await fixture({
    "index.html": '<img src="/photos/nope.webp" srcset="/photos/nope-2x.webp 2x">',
  });
  const r = run(dist);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /站点资源|站内资源/);
  assert.match(r.stdout, /nope-2x\.webp/);
});

test("--warn 只报告不阻断，外链和锚点不检查", async () => {
  const dist = await fixture({
    "index.html": '<a href="/missing/">坏链</a><a href="#top">锚点</a><a href="https://example.com/x">外链</a>',
  });
  const r = run(dist, ["--warn"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\/missing\//);
  assert.doesNotMatch(r.stdout, /example\.com/);
});
