import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

/** 静态服务器与 nginx 行为对齐：命中目录就找 index.html，找不到就回 404.html */
export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".map": "application/json; charset=utf-8",
};

export function serveDist(root) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const rel = decodeURIComponent(url.pathname);
      let file = path.join(root, rel);
      if (!file.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
      let info = await stat(file).catch(() => null);
      if (info?.isDirectory()) {
        file = path.join(file, "index.html");
        info = await stat(file).catch(() => null);
      }
      if (!info?.isFile()) {
        const body = await readFile(path.join(root, "404.html")).catch(() => null);
        if (body) {
          res.writeHead(404, { "Content-Type": MIME[".html"] }).end(body);
          return;
        }
        res.writeHead(404).end("Not found");
        return;
      }
      const body = await readFile(file);
      const contentType = MIME[path.extname(file)] ?? "application/octet-stream";
      // 和 nginx 一样按需 gzip。不压缩的话，本地量到的「页面下载量」会虚高一倍
      // （139 KB 的 HTML 在线上是 28 KB），任何按体积比较的结论都会失真。
      const compressible = /^(text\/|application\/(json|xml|javascript))/.test(contentType) || path.extname(file) === ".svg";
      const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
      if (compressible && acceptsGzip && body.length > 1024) {
        res
          .writeHead(200, { "Content-Type": contentType, "Content-Encoding": "gzip", Vary: "Accept-Encoding" })
          .end(gzipSync(body));
        return;
      }
      res.writeHead(200, { "Content-Type": contentType }).end(body);
    } catch {
      res.writeHead(500).end("error");
    }
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

/** 系统 Chrome 优先（本机），CI 上回落到 playwright 自带 chromium */
export function chromePath() {
  return (
    process.env.CHROME_PATH ??
    (globalThis.__mfChrome ?? undefined) ??
    (process.platform === "darwin" && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined)
  );
}
