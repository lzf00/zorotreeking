# Security headers · nginx 配置建议

把下面这一段加到生产服务器的 `nginx` 对应 server block 里。

```nginx
# === Security Headers ===
# 强制 HTTPS（一年），让浏览器记住只走 HTTPS。一旦上线就别再换证书 + 别拿掉。
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

# 防 XSS / 注入：浏览器不允许猜 MIME 类型
add_header X-Content-Type-Options "nosniff" always;

# 不允许被嵌入到任何域名的 <iframe>（防 clickjacking）
add_header X-Frame-Options "DENY" always;

# 跨域引用策略：跨域只发 origin，不带 path / query
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# 限制浏览器 API 权限。不需要的全关掉
add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), payment=(), usb=()" always;

# CSP（内容安全策略）：限制能 load 哪些资源
# 注意：这一行较激进。第一次部署后用 Chrome DevTools → Network → CSP 报告
# 看哪些被拦了，逐步放开。下面的允许列表来自当前站实际使用：
add_header Content-Security-Policy "
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://giscus.app https://webapi.amap.com https://restapi.amap.com https://jsapi-service.amap.com;
  worker-src 'self' blob:;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net;
  font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net data:;
  img-src 'self' data: https: blob:;
  media-src 'self' https:;
  connect-src 'self' https://decap-oauth.zoro1024111.workers.dev https://api.github.com https://*.githubusercontent.com https://giscus.app https://buttondown.com https://*.amap.com https://*.autonavi.com;
  frame-src 'self' https://buttondown.com https://giscus.app;
  base-uri 'self';
  form-action 'self' https://github.com https://buttondown.com;
  frame-ancestors 'self'
" always;
```

## 怎么应用

```bash
# 服务器上编辑对应站点配置后：
sudo nginx -t       # 语法检查
sudo systemctl reload nginx
```

## 怎么验证

```bash
curl -I https://www.zorotreeking.online | grep -iE "strict-transport|x-frame|x-content|referrer|permissions|content-security"
```

或者用 https://securityheaders.com/?q=zorotreeking.online 在线扫，目标 A+ 评级。

## 注意

1. **HSTS 是单向票**：一旦浏览器记住了就 1 年都强制 HTTPS。换证书 / 临时撤回 HTTPS 会让所有访客拿到证书错误打不开站。所以 `preload` 配上就别再撤。
2. **CSP 试错**：上线后看 DevTools → Console，被拦的 inline script / 第三方域名会报错。遇到了把对应域名 / hash 加进 CSP allowlist。
3. **Decap CMS 后台**（`/admin/`）走 cloudflare worker，CSP frame-ancestors 不影响。
4. **高德地图**：`script-src` 只放行官方 SDK、JSONP 和插件主机；`worker-src` 只允许同源与高德矢量底图所需的 `blob:` Worker；地图运行时请求只放行高德与 Autonavi 子域。部署流水线会幂等核对这些来源并在 `nginx -t` 失败时恢复备份。
