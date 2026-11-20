/**
 * 服务器侧体检脚本（scripts/check-server.mjs）的判定逻辑测试。
 *
 * 这些断言全是「线上真出现过」或「改错就会回归」的形态：
 * 两条 cache-control、/index.html 不重定向、只有 gzip、API 没缓存、软 404。
 * 用假 probe 喂响应，不联网。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { auditServer, formatFindings } from "../scripts/check-server.mjs";

const SCRIPT = new URL("../scripts/check-server.mjs", import.meta.url);
const PKG = new URL("../package.json", import.meta.url);
const WORKFLOW = new URL("../.github/workflows/site-audit.yml", import.meta.url);
const DOC = new URL("../docs/nginx-hardening.md", import.meta.url);

/** 造一个假响应：headerList 是有序数组，重复头就放两条。 */
const response = (status, headerList = [], body) => ({ status, headerList, body });

const HOME_BODY = '<html><script src="/_astro/page.B3sWyS9n.js"></script></html>';

/** 线上 f048b5d6 实测的样子：三处已知问题 + 三条建议。 */
const productionProbe = async (path) => {
  switch (path) {
    case "/":
      return response(200, [
        ["content-type", "text/html"],
        ["cache-control", "public, max-age=300, must-revalidate"],
        ["content-encoding", "gzip"],
        ["strict-transport-security", "max-age=31536000; includeSubDomains"],
        ["x-content-type-options", "nosniff"],
        ["referrer-policy", "strict-origin-when-cross-origin"],
        ["content-security-policy", "default-src 'self'"],
      ], HOME_BODY);
    case "/index.html":
    case "/en/index.html":
    case "/photo/index.html":
      return response(200, [["content-type", "text/html"]]);
    case "/_astro/page.B3sWyS9n.js":
      // nginx 的 expires + add_header 叠出来的真实形态
      return response(200, [
        ["cache-control", "max-age=31536000"],
        ["cache-control", "public, immutable"],
      ]);
    case "/photos/uploads/hudieren/13408537789923172.thumb480.webp":
      return response(200, [
        ["cache-control", "max-age=2592000"],
        ["cache-control", "public, max-age=2592000"],
      ]);
    case "/api/market/indices":
      return response(200, [["content-type", "application/json"]]);
    case "/definitely-not-a-real-page-9f3a/":
      return response(404, [["content-type", "text/html"]]);
    default:
      return response(404, []);
  }
};

const byId = (findings) => new Map(findings.map((item) => [item.id, item]));

test("线上实测形态：三处必须修、三条建议都能报出来", async () => {
  const findings = await auditServer({ probe: productionProbe });
  const map = byId(findings);

  assert.equal(map.get("index-redirect").level, "fail", "/index.html 200 必须报 fail");
  assert.match(map.get("index-redirect").detail, /200/);
  assert.match(map.get("index-redirect").fix, /return 301/, "要给出可直接抄的修法");

  assert.equal(map.get("index-redirect-nested").level, "warn", "子目录只算建议");

  assert.equal(map.get("brotli").level, "warn");
  assert.match(map.get("brotli").detail, /gzip/, "要指出当前退回 gzip");

  assert.equal(map.get("html-cache").level, "ok", "HTML 300s + must-revalidate 是合格值");

  assert.equal(map.get("duplicate-cache-control").level, "fail", "两行 cache-control 必须 fail");
  assert.match(map.get("duplicate-cache-control").detail, /2 行/);
  assert.match(map.get("duplicate-cache-control").fix, /expires/, "修法是去掉 expires");

  assert.equal(map.get("duplicate-cache-control-photo").level, "fail");

  assert.equal(map.get("api-cache").level, "warn", "行情接口没缓存");
  assert.equal(map.get("soft-404").level, "ok");
  assert.equal(map.get("security-headers").level, "ok");
});

test("全部修好后没有 fail，且报告里写「通过」", async () => {
  const fixedProbe = async (path) => {
    if (path === "/") {
      return response(200, [
        ["cache-control", "public, max-age=300, must-revalidate"],
        ["content-encoding", "br"],
        ["strict-transport-security", "max-age=31536000"],
        ["x-content-type-options", "nosniff"],
        ["referrer-policy", "strict-origin-when-cross-origin"],
        ["content-security-policy", "default-src 'self'"],
      ], HOME_BODY);
    }
    if (path.endsWith("index.html")) return response(301, [["location", path.replace("index.html", "")]]);
    if (path.startsWith("/_astro/")) return response(200, [["cache-control", "public, max-age=31536000, immutable"]]);
    if (path.startsWith("/photos/")) return response(200, [["cache-control", "public, max-age=2592000"]]);
    if (path.startsWith("/api/market/")) return response(200, [["cache-control", "public, max-age=30, stale-while-revalidate=60"]]);
    return response(404, []);
  };
  const findings = await auditServer({ probe: fixedProbe });
  assert.equal(findings.filter((item) => item.level === "fail").length, 0, "不该再有 fail");
  const map = byId(findings);
  assert.equal(map.get("brotli").level, "ok");
  assert.equal(map.get("index-redirect").level, "ok");
  // 修好后走的是正面分支，id 变成 asset-cache / photo-cache
  assert.equal(map.get("asset-cache").level, "ok");
  assert.equal(map.get("photo-cache").level, "ok");
  assert.match(formatFindings(findings), /通过/);
});

test("探测异常不会把整轮拖垮，而是记成一条 fail", async () => {
  const findings = await auditServer({
    probe: async (path) => {
      if (path === "/") throw new Error("证书过期");
      return response(404, []);
    },
  });
  const unreachable = findings.filter((item) => item.id.startsWith("unreachable:"));
  assert.ok(unreachable.length >= 1, "要记录连不上的路径");
  assert.equal(unreachable[0].level, "fail");
  assert.match(unreachable[0].detail, /证书过期/);
});

test("报告文本带图标和修法，便于直接贴进 run 页面", async () => {
  const text = formatFindings(await auditServer({ probe: productionProbe }));
  assert.match(text, /✗ `\/index\.html` 没有重定向/);
  assert.match(text, /→ 加 `location ~ \^\/\(\?<dir>/, "fix 要一起打印");
  assert.match(text, /3 条必须修/);
});

test("进了 npm 脚本和每周巡检，但没进阻塞发布的 gate", async () => {
  const pkg = JSON.parse(await readFile(PKG, "utf8"));
  assert.equal(pkg.scripts["check:server"], "node scripts/check-server.mjs");
  assert.ok(!pkg.scripts.gate.includes("check:server"), "需要公网可达，不能进 gate");

  const workflow = await readFile(WORKFLOW, "utf8");
  assert.match(workflow, /node scripts\/check-server\.mjs --base=https:\/\/www\.zorotreeking\.online/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/, "结论要进 run 页面");
  assert.match(workflow, /continue-on-error: true/, "巡检不能因为服务器侧问题红掉");

  const doc = await readFile(DOC, "utf8");
  assert.match(doc, /location ~ \^\(\?<prefix>\.\*\/\)index\\\.html\$/, "文档要给整段可抄的规则");
  assert.match(doc, /不要写 expires/, "文档要解释两行 cache-control 的成因");
  assert.match(doc, /add_header.*按层级继承/, "要提醒 add_header 会覆盖父级安全头");
  assert.match(doc, /npm run check:server/);
});

test("脚本本身用 rawHeaders 数重复头，并对压缩体先解压", async () => {
  const script = await readFile(SCRIPT, "utf8");
  assert.match(script, /rawHeaders/, "Headers 对象会把重复头合并，必须用 rawHeaders");
  assert.match(script, /brotliDecompressSync|gunzipSync/, "不解压就找不到 /_astro 引用");
  assert.match(script, /redirect: "manual"|method: "GET"/, "不能自动跟随 301，否则看不见重定向");
});
