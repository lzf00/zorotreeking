# zorotreeking

个人综合站：**AI 学习 · 个人投资 · 摄影 · 徒步**。

- 域名：`zorotreeking.online`（主站）+ 4 个二级域名（`ai. / invest. / photo. / hike.`）
- 技术栈：Astro 4 + MDX + TypeScript + Tailwind + React Islands
- 部署：Cloudflare Pages（自动构建 + Cron 定时 rebuild）
- 双语：默认中文（`/`）+ 英文（`/en`）

## 本地开发

```bash
npm install
npm run dev          # → http://localhost:4321
npm run build
npm run preview
```

## 项目结构

```
zorotreeking/
├── astro.config.mjs       # i18n、Cloudflare adapter、集成
├── tailwind.config.mjs    # 设计令牌、各栏目主色
├── functions/
│   └── _middleware.ts     # 子域名 → 路径内部 rewrite（生产环境生效）
├── scripts/               # 工具脚本（photo-add / invest-snapshot 之后加）
└── src/
    ├── content/
    │   ├── config.ts                  # 5 个 Content Collection 的 schema
    │   ├── ai/{slug}.{zh,en}.mdx
    │   ├── invest/{slug}.{zh,en}.mdx       # 复盘文章
    │   ├── invest-portfolio/{YYYY-MM}.yaml # 月度持仓快照
    │   ├── photo/{album}.{zh,en}.mdx       # 相册（引用 manifest）
    │   └── hike/{slug}.{zh,en}.mdx         # 徒步游记（引用 gpx）
    ├── data/photo-manifest/{album}.json    # 由 photo-add 脚本生成
    ├── i18n/ui.ts                          # 双语 UI 字符串 + 工具函数
    ├── components/                         # Navbar / Footer / SectionCard
    ├── layouts/BaseLayout.astro
    └── pages/
        ├── index.astro · about.astro
        ├── ai/index.astro · ai/[slug].astro
        └── en/                             # 英文路由镜像
```

## 双语写作约定

- 每篇文章两份 mdx：`my-post.zh.mdx` / `my-post.en.mdx`
- `translationKey` 字段两边相同（用于跨语言 routing）
- frontmatter 字段见 `src/content/config.ts`

## 部署：Cloudflare Pages

### 1. 创建 Pages 项目
- Cloudflare → Workers & Pages → Create → Pages → Connect to Git → 选 `zorotreeking` 仓库
- Build command：`npm run build`
- Output directory：`dist`
- Environment variables：暂无（之后 R2 上传脚本会用）

### 2. 绑定主域名 + 4 个子域名
在 Pages 项目 → Custom domains 添加：
- `zorotreeking.online`
- `www.zorotreeking.online`
- `ai.zorotreeking.online`
- `invest.zorotreeking.online`
- `photo.zorotreeking.online`
- `hike.zorotreeking.online`

DNS 由 Cloudflare 自动配（每个子域名 CNAME 到 `<project>.pages.dev`）。

### 3. 子域名 rewrite 已经在 `functions/_middleware.ts` 处理好了
- 用户访问 `ai.zorotreeking.online/hello-world`
- Middleware 内部把请求转到 `/ai/hello-world`
- 浏览器地址栏依然保持子域名形式

### 4. Cron 定时 rebuild（每天收盘后）
**方案：用 Cloudflare Pages Deploy Hook + GitHub Actions cron**

a) Cloudflare Pages → Settings → Builds & deployments → Deploy hooks → Create hook（命名 `daily-rebuild`），复制出 URL

b) 在仓库 `Settings → Secrets → Actions` 加 secret：`CF_DEPLOY_HOOK`

c) 仓库根目录创建 `.github/workflows/cron-rebuild.yml`：

```yaml
name: Daily rebuild
on:
  schedule:
    - cron: '30 7 * * 1-5'   # UTC 07:30 = 北京 15:30，工作日
  workflow_dispatch:
jobs:
  rebuild:
    runs-on: ubuntu-latest
    steps:
      - run: curl -X POST "$DEPLOY_HOOK"
        env:
          DEPLOY_HOOK: ${{ secrets.CF_DEPLOY_HOOK }}
```

每天收盘 30 分钟后，GitHub Actions 触发 Pages 重新构建，最新行情数据写入投资栏目。

## 后续 Roadmap（按优先级）

1. **AI 栏目**：Shiki 代码高亮、TOC 目录、阅读时长、Giscus 评论、RSS
2. **摄影栏目**：`scripts/photo-add.ts`（sharp + exifr + S3 SDK 上传 R2）、PhotoSwipe lightbox、瀑布流相册
3. **徒步栏目**：Leaflet 地图组件、GPX 解析（@tmcw/togeojson）抽出距离/爬升、海拔曲线
4. **投资栏目**：`scripts/invest-snapshot.ts`（拉新浪行情 → 写 YAML）、Recharts 净值曲线、持仓饼图
5. **全站**：客户端搜索（pagefind）、深色模式优化、404 页

## 当前状态

✅ 全站骨架、双语、子域名 middleware、AI 栏目 list+detail+示例文章
🚧 其余 3 个栏目仅 schema + 占位符，等接下来按 Roadmap 推进

启动 dev 服务器后访问 [http://localhost:4321](http://localhost:4321) 即可预览。
