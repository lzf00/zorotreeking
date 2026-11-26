import { chromium } from "playwright";
import { chromePath, serveDist } from "./lib/serve-dist.mjs";
const server = await serveDist("dist");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromePath() });
const routes = ["/invest/", "/invest/us-market/", "/invest/etf/", "/search/", "/guestbook/"];
for (const route of routes) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
  });
  let jsBeforeLoad = 0, jsTotal = 0, loaded = false;
  page.on("response", async (r) => {
    if (!new URL(r.url()).pathname.endsWith(".js")) return;
    let n = 0; try { n = (await r.body()).length; } catch { return; }
    jsTotal += n; if (!loaded) jsBeforeLoad += n;
  });
  await page.addInitScript(() => {
    window.__perf = { lcp: 0, tbt: 0 };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; })
      .observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.duration > 50) window.__perf.tbt += e.duration - 50;
    }).observe({ type: "longtask", buffered: true });
  });
  page.on("load", () => { loaded = true; });
  await page.goto(base + route, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(4000);
  const perf = await page.evaluate(() => window.__perf);
  console.log(`${route.padEnd(22)} LCP ${Math.round(perf.lcp)} ms · TBT ${Math.round(perf.tbt)} ms · JS(load 前) ${Math.round(jsBeforeLoad / 1024)} KB · JS 合计 ${Math.round(jsTotal / 1024)} KB`);
  await ctx.close();
}
await browser.close(); server.close();
