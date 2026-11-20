# nginx 侧加固（需要登录服务器操作）

站点的另一半在这些配置里，仓库里的门禁看不到，所以配套了一个**从外部探测**的体检脚本：

```bash
npm run check:server            # 探线上，逐项给结论 + 直接可抄的修法
npm run check:server -- --strict  # 有 fail 时退出码 1（给 CI 用）
```

2026-03 实测线上现状（`f048b5d6`）：**3 条必须修、3 条建议**。

| 项 | 现状 | 级别 |
|---|---|---|
| `/index.html` | 200（应 301 到 `/`） | 必须修 |
| `/_astro/*.js` 的 `cache-control` | 两行（`max-age=31536000` + `public, immutable`） | 必须修 |
| `/photos/**` 的 `cache-control` | 两行（`max-age=2592000` + `public, max-age=2592000`） | 必须修 |
| `/en/index.html` 等子目录 | 200 | 建议 |
| brotli | 只开 gzip | 建议 |
| `/api/market/*` | 没有 `cache-control`，每次回源 | 建议 |

## 为什么值得改

- **两行 `cache-control`**：nginx 的 `expires` 指令会自己发一条 `Cache-Control: max-age=…`，
  再叠一条 `add_header Cache-Control` 就变成两行、值还不一样。浏览器大多会合并，但
  CDN / 抓取工具 / 审计工具会各取第一行 —— 最坏情况是「按 30 天缓存」的那条被丢掉。
- **`/index.html` 200**：同一份内容两个 URL。canonical 已经指向正式地址所以不致命，
  但缓存键、外链统计、Search Console 都会各算一遍。
- **brotli**：HTML 28 KB → 24 KB。站点 1194 个页面全是 HTML，国内链路带宽最贵，
  静态字典对「大量重复的模板 HTML」效果最好。
- **`/api/market/*` 没有缓存**：开盘时每次进 ETF 页都回源打 FastAPI，是后端最容易被打满的时刻。

## 改法（整段贴进 `server { }`）

### 1. `index.html` 一律 301 到正式地址

```nginx
# /index.html → /；/en/index.html → /en/；/photo/x/index.html → /photo/x/
# 用命名捕获前缀，一条规则覆盖所有目录层级。不要用 `location = /index.html`，
# 那样只修根目录。
location ~ ^(?<prefix>.*/)index\.html$ {
    return 301 $prefix;
}
```

`/404.html` 不在规则内（它不叫 `index.html`），软 404 检查不受影响。

### 2. 指纹资源：删掉 `expires`，只留一条 `add_header`

```nginx
location /_astro/ {
    # 不要写 expires 1y; —— 它会再发一条 Cache-Control，和下面这条冲突
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    try_files $uri =404;
}

location /photos/ {
    # 相册图不是内容哈希命名，别用 immutable；30 天足够
    add_header Cache-Control "public, max-age=2592000" always;
    try_files $uri =404;
}
```

⚠️ nginx 的 `add_header` 是**按层级继承**的：子级 `location` 里一旦出现 `add_header`，
父级的 `add_header`（CSP、HSTS 等安全头）就不再继承。所以要么在每个 `location` 里重复
安全头，要么把安全头放进一个 `include security-headers.conf` 并在需要的地方都 include 一次。
改完用下面两条确认：

```bash
curl -sI https://www.zorotreeking.online/_astro/$(curl -s https://www.zorotreeking.online \
  | grep -o '_astro/[^"]*\.js' | head -1) | grep -ci '^cache-control'   # 期望输出 1
curl -sI https://www.zorotreeking.online/ | grep -ci 'strict-transport-security'  # 期望 1
```

### 3. brotli（`ngx_brotli`）

Debian/Ubuntu 官方源没有 `ngx_brotli`，三条路，任选：

```bash
# A. 直接用带模块的发行版包（最省事）
sudo apt install libnginx-mod-brotli

# B. 1Panel / 宝塔面板：在「网站 → 配置文件」里加下面的指令（面板自带的 nginx 多数已编进模块）
nginx -V 2>&1 | grep -o with-http_brotli   # 有输出说明模块已编进 nginx，直接配置即可

# C. 彻底不可用时保持 gzip 也行：`gzip_comp_level 6; gzip_min_length 1024;`
```

```nginx
# 只有 `nginx -V` 里能看到 brotli 模块时才加这两行，否则 nginx -t 会报 unknown directive
brotli on;
brotli_comp_level 6;
brotli_static on;
brotli_types text/html text/css application/javascript application/json application/manifest+json image/svg+xml text/plain text/xml;
```

`brotli_static on` 会让 nginx 优先用磁盘上的 `.br` 预压缩文件（构建脚本没有生成也不影响，
只是回落到动态压缩）。

### 4. `/api/market/*` 给短路缓存

```nginx
location /api/market/ {
    add_header Cache-Control "public, max-age=30, stale-while-revalidate=60" always;
    proxy_pass http://127.0.0.1:8000;   # 按实际后端地址改
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    # 后端自己已经发了 Cache-Control 的话，这里会被重复一条——先用
    #   curl -sI https://www.zorotreeking.online/api/market/indices
    # 确认后端没发，再决定加不加
}
```

行情 30 秒够用（前端本身也有轮询），`stale-while-revalidate` 让回源时用户不等。

## 生效与验证

```bash
sudo nginx -t && sudo systemctl reload nginx
npm run check:server              # 期望：3 条 fail 全部转 ok
```

## 现状

- **未应用**：这些都是服务器侧改动，我没有主机权限，本轮只交付了「探测 + 配置 + 验证」三件套。
- 改完把 `npm run check:server` 的输出贴回来即可确认；`--strict` 模式可以接进 CI，
  但因为需要公网可达，目前只在每周巡检报告里提示，不阻塞发布。
