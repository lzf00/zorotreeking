// Decap CMS GitHub OAuth 代理（Cloudflare Worker）
// 路径：
//   GET /auth      → 重定向到 GitHub OAuth 授权页
//   GET /callback  → GitHub 回调，换 token，校验白名单用户，回传到 Decap CMS
//
// 环境变量（绑定到 Worker）：
//   GITHUB_CLIENT_ID      ← GitHub OAuth App Client ID
//   GITHUB_CLIENT_SECRET  ← GitHub OAuth App Client Secret
//   ALLOWED_USERS         ← 逗号分隔的允许登录的 GitHub username（如 "lzf00"），留空则不限制
//   CMS_ORIGIN            ← 可选；postMessage 的 targetOrigin（Decap CMS 部署的 origin）
//                           不设时使用下面的硬编码默认值（生产域名）

// Decap CMS 父窗口 origin 白名单。token 通过 postMessage 回传时必须指定 targetOrigin，
// 不能用 "*"——否则任何 opener（恶意第三方）都能拿到 GitHub access token。
const DEFAULT_CMS_ORIGIN = "https://www.zorotreeking.online";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cmsOrigin = (env.CMS_ORIGIN || DEFAULT_CMS_ORIGIN).trim();

    // ── 1. 起步：重定向到 GitHub 授权页 ──
    if (url.pathname === "/auth") {
      const state = crypto.randomUUID();
      const target = new URL("https://github.com/login/oauth/authorize");
      target.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      target.searchParams.set("scope", "repo,user");
      target.searchParams.set("state", state);
      target.searchParams.set("redirect_uri", `${url.origin}/callback`);
      return Response.redirect(target.toString(), 302);
    }

    // ── 2. 回调：拿 code 换 token，校验用户，postMessage 给 Decap ──
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) return jsonError("missing code", 400);

      const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "decap-oauth-worker",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });
      const tokenData = await tokenResp.json();
      if (tokenData.error) return jsonError(tokenData.error_description || tokenData.error, 400);

      const token = tokenData.access_token;

      // ── 白名单校验 ──
      if (env.ALLOWED_USERS) {
        const userResp = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "decap-oauth-worker",
            Accept: "application/vnd.github+json",
          },
        });
        if (!userResp.ok) return jsonError("failed to load user", 502);
        const user = await userResp.json();
        const allow = env.ALLOWED_USERS.split(",").map((s) => s.trim()).filter(Boolean);
        if (!allow.includes(user.login)) {
          return new Response(closingHtml(`不在白名单：${user.login}`), { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 403 });
        }
      }

      // ── 把 token 回传到 Decap CMS 父窗口 ──
      const payload = JSON.stringify({ token, provider: "github" });
      return new Response(decapHandshakeHtml(payload, cmsOrigin), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // ── 健康检查 / 默认页 ──
    return new Response("Decap OAuth proxy. Endpoints: /auth, /callback", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function decapHandshakeHtml(payload, cmsOrigin) {
  // Decap CMS 通过 postMessage 协议接收 token，协议："authorization:github:success:<json>"
  //
  // 安全：targetOrigin 必须固定为 Decap CMS 部署域名，不能用 "*"——任何 opener
  // 都能截获 token。同时接收 "authorizing:github" 握手时必须校验 event.origin，
  // 防止恶意页面伪造握手骗取 token。
  const cmsOriginJson = JSON.stringify(cmsOrigin);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Authorizing…</title></head><body>
<p>正在登录…</p>
<script>
(function () {
  var CMS_ORIGIN = ${cmsOriginJson};
  function send(status) {
    var msg = 'authorization:github:' + status + ':' + ${JSON.stringify(payload)};
    if (window.opener) {
      window.opener.postMessage(msg, CMS_ORIGIN);
    }
  }
  // 仅接受来自 CMS_ORIGIN 的握手，防止第三方页面伪造
  window.addEventListener('message', function (e) {
    if (e.origin !== CMS_ORIGIN) return;
    if (e.data && e.data.toString().indexOf('authorizing:github') !== -1) {
      send('success');
    }
  }, false);
  // 主动告知父窗口
  if (window.opener) {
    window.opener.postMessage('authorizing:github', CMS_ORIGIN);
  }
  // 兜底：1.5 秒后直接发送成功（父窗口没监听时）
  setTimeout(function () { send('success'); }, 1500);
  setTimeout(function () { window.close(); }, 3000);
})();
</script>
</body></html>`;
}

function closingHtml(text) {
  return `<!doctype html><html><body><p>${text}</p><script>setTimeout(function(){window.close();},2500);</script></body></html>`;
}
