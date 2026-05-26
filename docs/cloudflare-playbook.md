# Cloudflare 前置 · 切换 Playbook

> 此文档只为后续接入 Cloudflare 准备。切换前请在低流量时段执行（推荐凌晨）。

## 为什么用 CF

- **DDoS 缓冲**：腾讯云免费层防御有限；CF 免费版能挡 L7 大部分洪水
- **边缘缓存**：静态资源（`/_astro/`、`/photos/`）从 CF 节点直接返回，国内访问也快
- **WAF**：免费规则集（OWASP Top 10）自动阻断常见注入
- **HTTPS 续期由 CF 负责**：源站 Let's Encrypt 可用 Origin Cert 替换，免费 15 年有效期

## 切换前 prerequisite

- [ ] 域名注册商：腾讯云 DNSPod
- [ ] 当前 NS：`f1g1ns1.dnspod.net` / `f1g1ns2.dnspod.net`
- [ ] 已生效 A 记录：apex + www → `110.40.142.199`
- [ ] 已生效 LE 证书：8 月 24 日到期
- [ ] 备案号：沪 ICP 备 2026021578 号-1（**腾讯云备案要求源站在境内，CF 仅做边缘加速，不算"接入商变更"**——但仍建议同步告知腾讯云客服）

## 切换步骤

### Phase 1：CF 端准备（不影响线上）

1. [Cloudflare](https://dash.cloudflare.com) 注册账号 → Add site → 输入 `zorotreeking.online`
2. 选 **Free** 套餐
3. CF 会自动扫描现有 DNS：核对 apex / www / ai / invest / photo / hike 6 条 A 记录都被识别（均 → 110.40.142.199）
4. **暂时把云朵图标全部置灰**（DNS-only），不要立刻开橙色代理——先验证 DNS 切换后能拿响应
5. 记下 CF 给的两个 NS：形如 `xxx.ns.cloudflare.com` / `yyy.ns.cloudflare.com`

### Phase 2：NS 切换

1. 登录 [DNSPod](https://console.dnspod.cn) → 我的域名 → `zorotreeking.online` → 域名设置 → **修改 DNS 服务器**
2. 把 NS 改成 CF 给的两条，**保存**
3. 等 NS 在全球生效（一般 30 分钟内，最长 24 小时）
4. 验证：`dig +short NS zorotreeking.online` 应返回 CF 的两个

### Phase 3：放量到 CF 边缘（云朵变橙）

1. CF DNS 页：apex + www 两条点云朵 → 橙色（Proxied）
2. **SSL/TLS → Overview**：模式选 **Full (strict)**（CF 与源站之间也要 TLS，不允许明文）
3. **SSL/TLS → Edge Certificates** → 确认 CF 自动签发的 Edge Cert 已生效
4. 验证 HTTPS：

   ```bash
   curl -sI https://www.zorotreeking.online/ | head -5
   # 应该看到 server: cloudflare
   ```

### Phase 4：源站收紧（只接 CF）

> 切换稳定 7 天后再做此步，以防 CF 故障时还能直连源站救急。

1. CF → IP Access Rules：把 CF 出口 IP 段 allowlist
2. 腾讯云安全组 / nginx：只允许 [CF IP 段](https://www.cloudflare.com/ips/) 访问 80/443
3. 此时直连 `110.40.142.199:443` 应被防火墙拦掉

### Phase 5：缓存与 WAF 调优

CF 默认会缓存：CSS / JS / 图片 / 字体。我们的 nginx 已经按内容类型设了 Cache-Control，CF 会遵守。可以再加：

- **Page Rules** / **Cache Rules**：
  - `*.zorotreeking.online/_astro/*` → Cache Everything, Edge Cache TTL 1 year
  - `*.zorotreeking.online/photos/*` → Cache Everything, Edge Cache TTL 30 days
  - `*.zorotreeking.online/admin/*` → **Bypass Cache**（重要：管理后台不能缓存）
  - `*.zorotreeking.online/api/*` → **Bypass Cache**
- **WAF → Security Level**：Medium
- **WAF → Bot Fight Mode**：开（免费版即可）
- **Speed → Brotli**：开

## 注意 / 不要踩的坑

1. **不要在 CF 改成 Full(strict) 之前点云朵橙色**——会触发 525 SSL handshake 错误
2. **AI 对话 SSE 流**：CF 默认不缓存 `text/event-stream`，但**自由计划下连接超时 100 秒**。我们的 chat 已设 300 秒 read_timeout，CF 会强行截断到 100 秒——对话写很长的回复时会断流。可选解决方案：
   - 升 Pro（$20/mo）→ 6 小时上限
   - 给 `/api/chat` 加 Cache Rule "Bypass Cache + Disable Performance"
   - 或者，**保留 chat 接口走非 CF 子域**（如 `api.zorotreeking.online`，DNS-only）
3. **Decap OAuth 回调**：CF 拦截某些 OAuth Worker 返回；提前在 CF Page Rules 把 `decap-oauth.zoro1024111.workers.dev` 排除（其实 CF 不代理这条，CF Worker 本身就在 CF 网络）
4. **腾讯云备案抽查**：备案要求"接入商即腾讯云"。CF 只是 CDN/防护，源站仍是腾讯云 VM——**没有改变接入商**。但工信部抽查可能误判，留好 CF 是"安全防护服务"的截图存证

## 回滚

如果出问题需要回到直连：

1. DNSPod：把 NS 改回 `f1g1ns1.dnspod.net` / `f1g1ns2.dnspod.net`
2. 等 30 分钟全球生效
3. 验证 `dig` 看到的 NS 已切回腾讯云
4. CF 那边的设置保留即可，未来想回 CF 直接切 NS 即可恢复

---

## 当前没切，所以这是参考文档

本仓库内除 nginx 配置外没有任何 Cloudflare 依赖。何时启用由站长决定。当前流量规模（< 1 千 PV/day）远未到需要 CF 的程度；什么时候出现：

- 单 IP 异常洪水（已被 anti-abuse 兜住，但 CF 更强）
- 国内访问明显变慢（CF Free 在国内体验有限，可考虑国内 CDN）
- 想用 CF Origin Cert 替换 LE 证书

那时候按上面 Phase 1-5 走。
