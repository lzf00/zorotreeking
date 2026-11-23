import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const loadConfig = async (path: string) => JSON.parse(await readProjectFile(path));

test("移动端预算覆盖了已修过的相册列表页与归档页", async () => {
  const config = await loadConfig(".lighthouserc.mobile.json");
  const urls: string[] = config.ci.collect.url;
  // 这三类页面是 2026-11 图片治理的重灾区（列表页封面曾下 3.7 MB 原图），
  // 桌面 15 URL 预算里没有它们，靠移动端周检兜底
  assert.ok(urls.some((u) => u.endsWith("/photo/")), "缺少相册列表页");
  assert.ok(urls.some((u) => u.endsWith("/photo/hudieren/")), "缺少 4K 封面相册");
  assert.ok(urls.some((u) => u.endsWith("/archive/")), "缺少归档页");
  assert.ok(urls.length >= 13);
});

test("移动端：性能分数只告警，LCP / TBT / CLS 是硬门禁（阈值按 CI 实测校准）", async () => {
  const assertions = (await loadConfig(".lighthouserc.mobile.json")).ci.assert.assertions;
  // 分数受 runner 负载影响，硬拦会假红；指标才反映真实回归
  assert.equal(assertions["categories:performance"][0], "warn");
  assert.ok(assertions["categories:performance"][1].minScore >= 0.85, "性能告警线太松（实测 98–100）");

  assert.equal(assertions["largest-contentful-paint"][0], "error");
  // 第 182 轮校准：这两条预算此前**从没被真实 CI 跑过**（workflow 一直没触发），
  // 第一次真跑（部署 878f4a28 之后）实测 LCP 3590 ms（本地同页 2.4 s）、TBT 278 ms。
  // 阈值按「CI 下限 + 余量」定，仍要能挡住 4K 封面那种回归（曾经 15.6 秒）。
  const lcp = assertions["largest-contentful-paint"][1].maxNumericValue;
  assert.ok(lcp >= 3800 && lcp <= 4500, `LCP 阈值要在 3800–4500ms（CI 实测 3590），实际 ${lcp}`);

  assert.equal(assertions["total-blocking-time"][0], "error");
  assert.ok(assertions["total-blocking-time"][1].maxNumericValue >= 350 && assertions["total-blocking-time"][1].maxNumericValue <= 600);

  assert.equal(assertions["cumulative-layout-shift"][0], "error");
  assert.ok(assertions["cumulative-layout-shift"][1].maxNumericValue <= 0.1);
});

test("两套预算的 URL 都是 https 生产地址，没有 localhost 漏网", async () => {
  for (const path of [".lighthouserc.json", ".lighthouserc.mobile.json"]) {
    const urls: string[] = (await loadConfig(path)).ci.collect.url;
    assert.ok(urls.length > 0, `${path} 没有 URL`);
    for (const url of urls) {
      assert.match(url, /^https:\/\/www\.zorotreeking\.online\//, `${path}: ${url}`);
    }
  }
});

test("无障碍 / SEO 在两端都是硬门禁，移动端额外守住触摸目标", async () => {
  const desktop = (await loadConfig(".lighthouserc.json")).ci.assert.assertions;
  const mobile = (await loadConfig(".lighthouserc.mobile.json")).ci.assert.assertions;

  // 两端都是 error（不是 warn），阈值各自不低于 0.9 / 0.95
  assert.equal(desktop["categories:accessibility"][0], "error");
  assert.equal(mobile["categories:accessibility"][0], "error");
  assert.ok(mobile["categories:accessibility"][1].minScore >= 0.95, "移动端无障碍门槛不该低于 0.95");
  assert.equal(mobile["categories:seo"][0], "error");
  assert.ok(mobile["categories:seo"][1].minScore >= 0.95);

  // 移动端独有的触摸目标检查（WCAG 2.2「目标尺寸」），桌面端测不出来
  assert.equal(mobile["target-size"][0], "error");
  assert.equal(mobile["target-size"][1].minScore, 1);

  for (const key of ["color-contrast", "is-on-https"]) {
    assert.equal(mobile[key][0], "error", `${key} 必须是硬门禁`);
    assert.equal(desktop[key][0], "error", `${key} 必须是硬门禁`);
  }
});
