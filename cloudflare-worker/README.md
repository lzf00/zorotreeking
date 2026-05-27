# decap-oauth · Cloudflare Worker

Decap CMS 用的 GitHub OAuth 代理。两个端点：

- `GET /auth` → 重定向到 GitHub OAuth 授权页
- `GET /callback` → GitHub 回调，验证白名单用户，把 token 回传给 Decap CMS

## 部署

不需要本地装 `wrangler`。直接在 Cloudflare 网页 dashboard 操作：

### 1. 创建 GitHub OAuth App

1. 打开 https://github.com/settings/developers → **New OAuth App**
2. 填写：
   - **Application name**: `ZoroTreeking Admin`
   - **Homepage URL**: `https://www.zorotreeking.online`
   - **Authorization callback URL**: `https://decap-oauth.<你的-cloudflare-username>.workers.dev/callback`
     （Worker 部署后才知道确切 URL，可以先写占位，部署完回头改）
3. 点 Register application
4. 在生成的 OAuth App 详情页：
   - 复制 **Client ID**（公开值）
   - 点 **Generate a new client secret** → 复制 **Client Secret**（一次性显示，立即保存）

### 2. 在 Cloudflare 创建 Worker

1. 打开 https://dash.cloudflare.com → 左侧 **Workers & Pages** → **Create application** → **Create Worker**
2. 名字填 `decap-oauth` → **Deploy**（先创建一个空 Worker）
3. 进入 Worker 详情 → **Edit code** → 用 `src/index.js` 的内容替换默认代码 → **Save and deploy**
4. 在 Worker 详情 → **Settings** → **Variables** → 添加：
   - `GITHUB_CLIENT_ID` (Plaintext) = 第 1 步的 Client ID
   - `GITHUB_CLIENT_SECRET` (Encrypt) = 第 1 步的 Client Secret
   - `ALLOWED_USERS` (Plaintext) = `<your-github-username>`（只允许你登录）
5. **Save and deploy**

### 3. 把 Worker URL 回填到 Decap 配置

1. Worker URL 形如 `https://decap-oauth.<你的-cloudflare-子域>.workers.dev`
2. 改 `public/admin/config.yml` 里 `base_url` 为这个 URL
3. 改 GitHub OAuth App 的 **Authorization callback URL** 为 `<Worker URL>/callback`
4. `git add . && git commit -m "Update Decap admin OAuth endpoint" && git push`

### 4. 验证

打开 `https://www.zorotreeking.online/admin/`（备案通过后）或 `http://localhost:4321/admin/`（本地预览）：
- 点 "Login with GitHub" → 跳到 GitHub → 授权 → 返回 admin 主界面
- 看到 8 个集合（AI / 投资 / 摄影 / 徒步，每个分中英）
- 试着新建一篇文章 → 写正文 → Publish → 几秒后看到 GitHub 仓库里新 commit

## 调试

- Worker logs: dashboard → Workers → decap-oauth → **Logs** → **Begin log stream**
- 常见错误：
  - 403 "不在白名单"：检查 `ALLOWED_USERS` 拼写
  - `bad_verification_code`：Client ID / Secret 配错；或 callback URL 不一致
  - 弹窗一直不关：Decap CMS 父窗口域名不匹配，检查浏览器 console
