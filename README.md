# zorotreeking

个人综合站：**AI 学习 · 个人投资 · 摄影 · 徒步**。

- 线上：**[https://www.zorotreeking.online](https://www.zorotreeking.online)**
- 备案：沪 ICP 备 2026021578 号-1
- 域名：`zorotreeking.online` + `www.` / `ai.` / `invest.` / `photo.` / `hike.`（4 子域 301 到主站对应栏目）
- 技术栈：Astro 4 + MDX + TypeScript + Tailwind + React Islands + FastAPI（后台 AI / 统计 / 反馈）
- 部署：腾讯云 VM + nginx + Let's Encrypt，GitHub Actions 自动 build + rsync
- 双语：默认中文（`/`）+ 英文（`/en`）
- 在线写文章：Decap CMS（`/admin/`），GitHub OAuth 登录（Cloudflare Worker 中转）
- AI 助手：悬浮按钮 → 多模型聊天（DeepSeek / Kimi / 豆包 / Claude / GPT / Gemini / 通义千问 / 智谱 / AI Yingji）+ 联网搜索 + 文件上传

## 架构

```
你 ─push─▶ GitHub
              ├─ Actions: npm ci → 拉行情 → 扫照片 → astro build → rsync ─▶ 腾讯云 nginx
              └─ Decap admin（浏览器内）─▶ GitHub OAuth ─▶ Cloudflare Worker
                                              ▼
                                     拿到 token，直接通过 GitHub API
                                     提交 commit → 触发 Actions（同上）

线上：https://www.zorotreeking.online
  └─ nginx (443 HTTPS, LE 证书)
     ├─ /            ─▶ Astro 静态站 dist/
     ├─ /admin/      ─▶ Decap CMS
     ├─ /api/chat/   ─▶ FastAPI (127.0.0.1:8800) AI 聊天（SSE 流）
     ├─ /api/feedback, /api/track, /api/data/, /api/chat/clear
     │              ─▶ FastAPI 统计 / 反馈 / 数据主体权利
     └─ 4 个栏目子域名 → 301 redirect 到 apex /<section>/

服务器：/opt/ai-agent/  FastAPI（systemd 单元 ai-agent.service）
        └─ stats.db    SQLite（用量统计 / 反馈 / 拦截记录 / 处置记录）
```

**GitHub** 是源代码 + 工作流 + 身份验证的唯一真源。**Cloudflare** 只做一件事：跑 50 行的 OAuth 中转 Worker。**腾讯云 VM** 是 nginx + FastAPI 居所。**腾讯云 COS** 是 SQLite 异地备份目标。

## 写文章

**方式 A · 浏览器在线**（推荐日常用）：

1. 打开 [`/admin/`](https://www.zorotreeking.online/admin/)
2. Login with GitHub
3. 选集合（AI 学习 / 个人投资 / 摄影 / 徒步）→ 新建文章 → 写 → Publish
4. 3 分钟后线上更新

**方式 B · 本地编辑器**（适合写代码块多的长文）：

```bash
cd zorotreeking
npm install
npm run dev              # http://localhost:4321 实时预览
# 1. 新建 src/content/<section>/<slug>.zh.mdx
# 2. （可选）同 slug 加 .en.mdx
# 3. git add -A && git commit -m "..." && git push
```

## 本地开发

```bash
npm install
npm run dev          # 启动开发服务器
npm run build        # 生产构建（自动跑 build-photo-manifests → astro build → pagefind 索引）
npm run preview      # 预览构建产物
npm run photo:manifests  # 手动重建相册 manifest
```

## 项目结构

```
.github/workflows/
  deploy.yml                 CI/CD：扫相册 → build → rsync 到服务器
  daily-digest.yml           每日 cron 抓 AI 论文 + 财经新闻，生成 digest .mdx

astro.config.mjs             Astro 配置（i18n、Markdown、Shiki、auto-TOC、vite proxy）
tailwind.config.mjs          设计令牌

public/
  admin/
    index.html               Decap CMS 入口（Apple-style 主题 + 多上传补丁）
    config.yml               4 个集合的 schema + OAuth 配置
  photos/uploads/<album>/    Decap 上传到这里，build 期扫盘生成 manifest
  gpx/                       徒步轨迹文件
  favicon.svg

cloudflare-worker/           Decap OAuth 中转 Worker（独立部署）
  src/index.js               ~50 行 JS

docs/
  cloudflare-playbook.md     未来切 Cloudflare 边缘加速的 5-phase 计划

scripts/
  digest-fetch.ts            每日抓论文/新闻 → 调用 LLM 改写 → 写 digest mdx
  digest-sources/            10+ 数据源（arxiv / HF / 同花顺 / 东方财富 / Yahoo …）
  build-photo-manifests.ts   扫 public/photos/uploads → 抽 EXIF/尺寸 → 生 manifest
  photo-add.ts               旧版离线相册工具（手动 CLI 用）
  invest-snapshot.ts         拉新浪行情，写当月持仓 YAML
  lib/llm.ts                 LLM 客户端（OpenAI / ARK / DashScope 多家）

src/
  content/
    config.ts                4 + 1 集合的 Zod schema
    ai/         *.{zh,en}.mdx + digest-YYYY-MM-DD.zh.mdx (cron 产)
    invest/     *.{zh,en}.mdx + digest-YYYY-MM-DD.zh.mdx (cron 产)
    invest-portfolio/  {YYYY-MM}.yaml + _holdings.yaml
    photo/      *.{zh,en}.mdx
    hike/       *.{zh,en}.mdx
  data/photo-manifest/  *.json    相册 manifest（自动生成，不要手改）
  i18n/ui.ts                       UI 字符串 + 双语路由工具
  layouts/
    BaseLayout.astro               全站基座（meta / OG / Search / AIWidget / tracking）
    PhotoLayout.astro              摄影专用沉浸式深色 layout
  components/
    Navbar.astro                   顶栏 + 主题切换 + 搜索 / 订阅 / 后台入口
    Footer.astro                   底部 + 6 合规链接 + ICP 备案号
    SectionCard.astro              主页 4 个栏目卡
    AIChatWidget.tsx               悬浮 AI 助手（React island）
    SearchModal.tsx                pagefind 全文搜索弹窗
    FeedbackButtons.tsx            文章 ❤/👎
    PhotoGallery.tsx               PhotoSwipe + EXIF caption
    TagChip.astro / TOC.astro / Giscus.astro
  lib/                             gpx 解析 / 阅读时长 / photo-manifest / tags
  pages/                           4 栏目 × 2 语言 + 合规页族 + 工具页
    index.astro / en/index.astro
    about / contact / terms / privacy / data / subscribe（各 zh+en）
    tag/[tag].astro + tag/index.astro
    ai/[slug].astro / invest/[slug].astro / photo/[slug].astro / hike/[slug].astro
    rss.xml.ts / sitemap.xml.ts

AI_Agent/                          FastAPI 后端源码（部署到服务器 /opt/ai-agent/）
  deepseek_chat_app.py             主程序：聊天 / 反馈 / 统计 / 合规 endpoints
  models.yaml                      多 LLM 路由配置
  sensitive_words.txt              对话敏感词过滤词表
  .env.example                     需要的环境变量样例
```

## 部署

### 自动（标准流程）

```bash
git push origin main
```

`.github/workflows/deploy.yml` 自动触发：

1. checkout
2. `npm ci`
3. 用新浪行情刷新当月持仓 YAML（失败不阻塞）
4. `tsx scripts/build-photo-manifests.ts` 扫 `public/photos/uploads/` 写 manifest
5. `astro build` + `pagefind` 索引 → 生成 `dist/`
6. SSH 私钥从 `SSH_DEPLOY_KEY` secret 解码
7. `rsync dist/ → 腾讯云:/www/wwwroot/zorotreeking/dist/`

### 触发方式

- **push 到 main**：每次推送自动 build + deploy
- **每日 08:00 北京时间**：`daily-digest.yml` 抓最新内容，commit 触发再次 deploy
- **每个工作日 15:30 北京时间**：定时 rebuild（拉一次实时行情）
- **手动触发**：GitHub repo → Actions → Build & Deploy → Run workflow

### FastAPI 后端部署

FastAPI 不走 GitHub Actions，需要手动 sync：

```bash
# 改完 AI_Agent/deepseek_chat_app.py 后
scp AI_Agent/deepseek_chat_app.py root@110.40.142.199:/opt/ai-agent/
ssh root@110.40.142.199 'systemctl restart ai-agent'
```

服务以 systemd 单元跑（`ai-agent.service`），监听 `127.0.0.1:8800`，nginx 反代到 `/api/*`。日志：`journalctl -u ai-agent -f`。

### nginx 配置

位于服务器 `/www/server/panel/vhost/nginx/zorotreeking.conf`（由宝塔面板 include）。关键结构：

- `80` → 301 到 HTTPS + ACME 续期通道
- `443` → 主站 + 所有 `/api/*` 反代
- 4 个栏目子域 → 301 到 `https://www./<section>/`
- 安全头从 `zorotreeking_security_headers.conf` include（HSTS / CSP / X-Frame / Referrer / Permissions）
- 速率限制 5 个 zone（chat / upload / meta / feedback / track）
- 缓存按内容类型分层（`_astro/` 1y / `photos/` 30d / `pagefind/` 1h / `rss.xml` 10m / HTML 5m / `admin/` no-cache）
- 自动 IP blocklist：`zorotreeking_blocklist.conf`（由 anti-abuse 脚本维护）

## 在线后台（Decap CMS）

**首次配置**：参考 `cloudflare-worker/README.md`。需要：

1. 创建 GitHub OAuth App
2. 部署 Cloudflare Worker（环境变量配 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `ALLOWED_USERS=lzf00`）
3. 把 Worker URL 填到 `public/admin/config.yml` 的 `base_url`

**日常用**：浏览器开 [`/admin/`](https://www.zorotreeking.online/admin/) 登录就能写文章。

**安全**：OAuth Worker 限制 `ALLOWED_USERS=lzf00`，其他人哪怕用自己的 GitHub 登录也会被挡住。

## 合规栈

按 工信部 / 网信办 备案安全评估 6 条要求落地：

| 维度 | 实现 |
|---|---|
| 实名注册 | 站点不开放公开注册（在 about + terms 明文声明） |
| 日志留存 ≥6 月 | nginx logrotate 200 天 + SQLite 每日备份（本地保 200 份 + 异地推 COS） |
| 违法信息防范 | `sensitive_words.txt` 在 `/api/chat` 入口过滤，命中写 `chat_filtered_log` 拒发 LLM |
| 个人信息保护 | HTTPS + HSTS + CSP 全站，文件 600 权限，`/api/admin/*` 公网 404，限频 5 个 zone |
| 投诉举报 | Footer + `/about` + `/contact`：1437066318@qq.com，48 小时响应承诺 |
| 配合执法 | `/api/admin/ip-trace?ip=...` 按 IP 反查 feedback / pageviews / chat_filtered_log；`moderation_log` 记每次处置 |
| 数据主体权利 | `/data`（zh+en）：访客自查 + 一键删除自己所有记录 |
| 防爬 / 反爆破 | `anti-abuse.sh` 扫日志 → 写 nginx `geo` deny → 自动封 IP 24h |

详细政策三文：[`/terms`](https://www.zorotreeking.online/terms) / [`/privacy`](https://www.zorotreeking.online/privacy) / [`/contact`](https://www.zorotreeking.online/contact)

## AI Agent 后端

FastAPI 应用 `/opt/ai-agent/deepseek_chat_app.py`，提供：

- `POST /api/chat`：多模型对话（SSE 流），命中敏感词直接 400
- `POST /api/upload`：文件附件（PDF / docx / 图片）
- `GET  /api/models` / `POST /api/new_session`
- `GET/POST /api/feedback`：文章 ❤/👎
- `POST /api/track`：页面访问统计
- `GET  /api/data/me` / `POST /api/data/delete`：访客自助查/删
- `POST /api/chat/clear`：清自己的 chat session 内存
- `GET  /admin` + `GET /api/admin/stats` + `GET /api/admin/moderation` + `GET /api/admin/ip-trace`：仅本机访问（nginx 公网 404）

**SQLite 表**：`llm_calls` / `search_calls` / `feedback` / `pageviews` / `chat_filtered_log` / `moderation_log`。

**配置文件**：

- `/opt/ai-agent/.env`：LLM API keys（OpenAI / ARK / DashScope / Anthropic / Gemini …）
- `/opt/ai-agent/models.yaml`：多 LLM 路由 + 价格表
- `/opt/ai-agent/.env.offsite`：异地备份凭据（COS / OSS / S3 兼容）

## 备份

```
本地：/opt/ai-agent/backup-stats.sh    每日 03:00 cron，sqlite3 .backup 复制 + gzip
                                       目录 /opt/ai-agent/backups/  保留 200 份

异地：/opt/ai-agent/backup-offsite.sh   每日 03:05 cron，推到腾讯云 COS
                                       bucket: zorotreeking-backup-1301406326 (ap-nanjing)
                                       凭据不配 → 静默 skip

日志：/etc/logrotate.d/zorotreeking     nginx 日志日轮转 + gzip 保留 200 天
```

恢复：从 COS 拉某天的 `stats-YYYYMMDD.db.gz` → `gunzip` → 替换 `/opt/ai-agent/stats.db` → `systemctl restart ai-agent`。

## 工具脚本

```bash
# 拉今天的行情，写当月持仓快照（CI 也会自动跑）
npx tsx scripts/invest-snapshot.ts
npx tsx scripts/invest-snapshot.ts 2026-05    # 指定月

# 扫照片上传目录 → 生成 manifest（CI 也会自动跑，本地 npm run build 也会跑）
npx tsx scripts/build-photo-manifests.ts

# 旧版离线相册工具：处理本地照片目录 → 生成缩略图 + 抽 EXIF + 写 manifest
npx tsx scripts/photo-add.ts <album-slug> <照片目录>

# 手动跑一次每日 digest（默认 cron 已在 08:00 跑）
npx tsx scripts/digest-fetch.ts
```

## 评论系统（Giscus）

可选启用：

1. GitHub repo Settings 启用 Discussions
2. 安装 [Giscus App](https://github.com/apps/giscus) 并选这个 repo
3. 去 https://giscus.app 用 repo URL 获取 4 个 ID
4. GitHub repo Settings → Secrets and variables → Actions → 加 4 个：
   - `PUBLIC_GISCUS_REPO=lzf00/zorotreeking`
   - `PUBLIC_GISCUS_REPO_ID=...`
   - `PUBLIC_GISCUS_CATEGORY=Announcements`
   - `PUBLIC_GISCUS_CATEGORY_ID=...`

之后每篇 AI 文章底部自动出现评论区。

## 当前状态

| 项 | 状态 |
|---|---|
| 主站 + admin + CI/CD | ✅ 运行中 |
| ICP 备案 | ✅ 沪 ICP 备 2026021578 号-1 |
| HTTPS（LE，自动续期） | ✅ 到期前 30 天自动续 |
| 6 域名公网烟测 | ✅ apex / www / 4 子域全部 301 → HTTPS 主域 |
| 安全响应头 | ✅ HSTS + CSP + X-Frame + Referrer + Permissions |
| 合规栈（备案 6 条） | ✅ 全部落地 |
| 异地备份 | ✅ 腾讯云 COS（南京）每日 03:05 |
| Cloudflare 前置 | ⏳ 文档就绪 [`docs/cloudflare-playbook.md`](docs/cloudflare-playbook.md)，未启用 |
| `/admin` IP 白名单 | ⏳ 暂未启用 |

## 维护手册速查

```bash
# 看后端日志
ssh root@110.40.142.199 'journalctl -u ai-agent -f'

# 看 nginx 访问 / 错误日志
ssh root@110.40.142.199 'tail -f /www/wwwlogs/zorotreeking.log'
ssh root@110.40.142.199 'tail -f /www/wwwlogs/zorotreeking.error.log'

# 看每日备份是否成功
ssh root@110.40.142.199 'tail -20 /var/log/zorotreeking-backup.log'

# 看 anti-abuse 拉黑了哪些 IP
ssh root@110.40.142.199 'cat /www/server/panel/vhost/nginx/zorotreeking_blocklist.conf'

# 重启 FastAPI
ssh root@110.40.142.199 'systemctl restart ai-agent'

# 重载 nginx（改完 vhost 后）
ssh root@110.40.142.199 'nginx -t && systemctl reload nginx'

# 手动跑一次异地备份
ssh root@110.40.142.199 '/opt/ai-agent/backup-offsite.sh'

# 查某 IP 近 30 天在站点上的所有行为（仅本机）
ssh root@110.40.142.199 'curl -sS "http://127.0.0.1:8800/api/admin/ip-trace?ip=1.2.3.4&days=30"'
```
