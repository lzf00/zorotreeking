# zorotreeking

个人综合站：**AI 学习 · 个人投资 · 摄影 · 徒步**。

- 域名：`zorotreeking.online` + `www.` / `ai.` / `invest.` / `photo.` / `hike.`
- 技术栈：Astro 4 + MDX + TypeScript + Tailwind + React Islands
- 部署：腾讯云 + nginx，GitHub Actions 自动构建 + rsync
- 双语：默认中文（`/`）+ 英文（`/en`）
- 在线写文章：Decap CMS（`/admin/`），GitHub OAuth 登录（Cloudflare Worker 中转）

## 架构

```
你 ─push─▶ GitHub
              ├─ Actions: npm ci → 拉行情 → astro build → rsync ─▶ 腾讯云 nginx
              └─ Decap admin (浏览器内) ─▶ GitHub OAuth ─▶ Cloudflare Worker
                                              ▼
                                     拿到 token，直接通过 GitHub API
                                     提交 commit → 触发 Actions（同上）

腾讯云 110.40.142.199
  └─ nginx: /www/wwwroot/zorotreeking/dist/  ←─ 所有 6 个域名都指到这台机
        └─ 4 个栏目子域名 → 301 redirect 到 apex /<section>/
```

**GitHub** 是源代码 + 工作流 + 身份验证的唯一真源。**Cloudflare** 只做一件事：跑 50 行的 OAuth 中转 Worker。**腾讯云** 是网站文件实际居所。

## 写文章

**方式 A · 浏览器在线**（推荐日常用）：

1. 打开 `https://www.zorotreeking.online/admin/`（备案前先用 [http://localhost:4321/admin/index.html](http://localhost:4321/admin/index.html)）
2. Login with GitHub
3. 选集合（AI 学习 / 个人投资 / 摄影 / 徒步）→ 新建文章 → 写 → Publish
4. 3 分钟后线上更新

**方式 B · 本地编辑器**（适合写代码块多的长文）：

```bash
cd zorotreeking
npm install              # 首次
npm run dev              # http://localhost:4321 实时预览，热更新
# 1. 新建 src/content/<section>/<slug>.zh.mdx
# 2. （可选）同 slug 加 .en.mdx
# 3. git add -A && git commit -m "..." && git push
```

## 本地开发

```bash
npm install
npm run dev          # 启动开发服务器
npm run build        # 生产构建到 dist/
npm run preview      # 预览构建产物
```

## 项目结构

```
.github/workflows/deploy.yml    CI/CD：build + rsync 到服务器
astro.config.mjs                Astro 配置（i18n、Markdown、Shiki 高亮、auto-TOC）
tailwind.config.mjs             设计令牌

public/
  admin/                        Decap CMS（在线写文章后台）
    index.html                  入口 + "回到主站"浮动按钮
    config.yml                  4 个集合的 schema + OAuth 配置
  gpx/                          徒步轨迹文件
  favicon.svg

cloudflare-worker/              Decap CMS 用的 OAuth 中转 Worker（独立部署）
  src/index.js                  ~50 行 JS

scripts/                        离线工具（手动跑，非 CI）
  invest-snapshot.ts            拉新浪行情 + 写月度持仓 YAML
  photo-add.ts                  处理照片 + 上传 R2 + 生成 manifest

src/
  content/                      Content Collections
    config.ts                   5 个集合的 Zod schema
    ai/         *.{zh,en}.mdx
    invest/     *.{zh,en}.mdx
    invest-portfolio/  {YYYY-MM}.yaml + _holdings.yaml
    photo/      *.{zh,en}.mdx
    hike/       *.{zh,en}.mdx
  data/photo-manifest/  *.json  照片 manifest（由 photo-add.ts 生成）
  i18n/ui.ts                    UI 字符串 + 双语路由工具
  layouts/BaseLayout.astro      全站基座
  components/                   Navbar / Footer / 各种 React island 组件
  lib/                          gpx 解析 / 阅读时长 / photo-manifest 加载
  pages/                        4 栏目 × 2 语言 = 8 路由组 + index/about/rss/sitemap
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
4. `npm run build` → 生成 `dist/`
5. SSH 私钥从 `SSH_DEPLOY_KEY` secret 解码
6. `rsync dist/ → 腾讯云:/www/wwwroot/zorotreeking/dist/`

### 触发方式

- **push 到 main**：每次推送自动 build + deploy
- **每个工作日 15:30 北京时间**：定时 rebuild（拉一次实时行情）
- **手动触发**：GitHub repo → Actions → Build & Deploy → Run workflow

### 服务器侧 nginx 配置

位于服务器 `/www/server/panel/vhost/nginx/zorotreeking.conf`（由宝塔面板 include），结构：

- `zorotreeking.online` + `www.` → 服务 `dist/`
- `ai./invest./photo./hike.` → 301 redirect 到 `www./<section>/`

备案通过后用 `certbot --nginx` 给 6 个域名签 HTTPS 证书。

## 在线后台（Decap CMS）

**首次配置**：参考 `cloudflare-worker/README.md`。需要：

1. 创建 GitHub OAuth App
2. 部署 Cloudflare Worker（环境变量配 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `ALLOWED_USERS=lzf00`）
3. 把 Worker URL 填到 `public/admin/config.yml` 的 `base_url`

**日常用**：浏览器开 `/admin/` 登录就能写文章。

**安全**：OAuth Worker 限制 `ALLOWED_USERS=lzf00`，其他人哪怕用自己的 GitHub 登录也会被挡住。

## 工具脚本

```bash
# 拉今天的行情，写当月持仓快照（也由 CI 自动跑）
npx tsx scripts/invest-snapshot.ts            # 当前月
npx tsx scripts/invest-snapshot.ts 2026-05   # 指定月

# 处理照片：生成缩略图 + 抽 EXIF + 上传 R2（或本地 public/photos/）+ 写 manifest
npx tsx scripts/photo-add.ts <album-slug> <照片目录>
```

## 评论系统（Giscus）

可选启用：

1. 在 GitHub repo Settings 启用 Discussions
2. 安装 [Giscus App](https://github.com/apps/giscus) 并选这个 repo
3. 去 https://giscus.app 用 repo URL 获取 4 个 ID
4. GitHub repo Settings → Secrets and variables → Actions → 加 4 个环境变量：
   - `PUBLIC_GISCUS_REPO=lzf00/zorotreeking`
   - `PUBLIC_GISCUS_REPO_ID=...`
   - `PUBLIC_GISCUS_CATEGORY=Announcements`
   - `PUBLIC_GISCUS_CATEGORY_ID=...`

之后每篇 AI 文章底部自动出现评论区。

## 当前状态 / 待办

- ✅ 主站 + admin + CI/CD 全跑通
- ⏳ **ICP 备案审核中**（备案通过前域名 80/443 被腾讯云拦截，看到的是备案提示页；rsync 等部署流不受影响）
- ⏳ 备案通过后：certbot HTTPS + nginx HTTPS 301 + 6 域名公网烟测
