// Decap CMS GitHub OAuth 代理（Cloudflare Worker）
// 路径：
//   GET /auth      → 重定向到 GitHub OAuth 授权页
//   GET /callback  → GitHub 回调，换 token，校验白名单用户，回传到 Decap CMS
//
// 环境变量（绑定到 Worker）：
//   GITHUB_CLIENT_ID      ← GitHub OAuth App Client ID
//   GITHUB_CLIENT_SECRET  ← GitHub OAuth App Client Secret
//   ALLOWED_USERS         ← 逗号分隔的允许登录的 GitHub username（如 "lzf00"），必须配置
//   CMS_ORIGIN            ← 可选；postMessage 的 targetOrigin（Decap CMS 部署的 origin）
//                           不设时使用下面的硬编码默认值（生产域名）

// Decap CMS 父窗口 origin 白名单。token 通过 postMessage 回传时必须指定 targetOrigin，
// 不能用 "*"——否则任何 opener（恶意第三方）都能拿到 GitHub access token。
const DEFAULT_CMS_ORIGIN = "https://www.zorotreeking.online";
const STATE_COOKIE = "decap_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;

// ── 通用 OAuth 反代路由（TrailLens 后端 OAUTH_PROXY_BASE 走这里）──
// 后端硬编码路径映射,不能改路径名。签名对齐 apps/api/traillens_api/routes/oauth.py
const OAUTH_PROXY_ROUTES = {
  "/google/token":    { upstream: "https://oauth2.googleapis.com/token", methods: ["POST"] },
  "/google/userinfo": { upstream: "https://www.googleapis.com/oauth2/v3/userinfo", methods: ["GET"] },
  "/github/token":    { upstream: "https://github.com/login/oauth/access_token", methods: ["POST"] },
  "/github/user":     { upstream: "https://api.github.com/user", methods: ["GET"] },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cmsOrigin = (env.CMS_ORIGIN || DEFAULT_CMS_ORIGIN).trim();

    // ── 0. 通用 OAuth 反代(TrailLens 等后端调用)──
    const proxyRoute = OAUTH_PROXY_ROUTES[url.pathname];
    if (proxyRoute) {
      if (!proxyRoute.methods.includes(request.method)) {
        return new Response("method_not_allowed", {
          status: 405,
          headers: {
            Allow: proxyRoute.methods.join(", "),
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
          },
        });
      }
      return proxyToUpstream(request, proxyRoute.upstream, url);
    }

    // ── 1. 起步：重定向到 GitHub 授权页 ──
    if (url.pathname === "/auth") {
      if (!env.GITHUB_CLIENT_ID) return jsonError("OAuth is not configured", 500);
      const state = crypto.randomUUID();
      const target = new URL("https://github.com/login/oauth/authorize");
      target.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      target.searchParams.set("scope", "repo,user");
      target.searchParams.set("state", state);
      target.searchParams.set("redirect_uri", `${url.origin}/callback`);
      return new Response(null, {
        status: 302,
        headers: {
          Location: target.toString(),
          "Cache-Control": "no-store",
          "Set-Cookie": stateCookie(state),
        },
      });
    }

    // ── 2. 回调：拿 code 换 token，校验用户，postMessage 给 Decap ──
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const storedState = getCookie(request, STATE_COOKIE);
      const allow = String(env.ALLOWED_USERS || "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);

      if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
        return oauthError("OAuth is not configured", 500);
      }
      // 个人 CMS 必须配置白名单；配置缺失时不能退化为任意 GitHub 用户可登录。
      if (allow.length === 0) {
        return oauthError("OAuth user allowlist is not configured", 500);
      }
      if (!code) return oauthError("missing code", 400);
      if (!state || !storedState || state !== storedState) {
        return oauthError("invalid OAuth state", 400);
      }

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
          redirect_uri: `${url.origin}/callback`,
        }),
      });
      const tokenData = await tokenResp.json().catch(() => ({}));
      if (!tokenResp.ok || tokenData.error || !tokenData.access_token) {
        return oauthError("OAuth token exchange failed", 400);
      }

      const token = tokenData.access_token;

      // ── 白名单校验 ──
      const userResp = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "decap-oauth-worker",
          Accept: "application/vnd.github+json",
        },
      });
      if (!userResp.ok) return oauthError("failed to load user", 502);
      const user = await userResp.json();
      if (!allow.includes(String(user.login || "").toLowerCase())) {
        const nonce = createCspNonce();
        return new Response(closingHtml(`不在白名单：${user.login || "unknown"}`, nonce), {
          status: 403,
          headers: oauthHtmlHeaders(nonce),
        });
      }

      // ── 把 token 回传到 Decap CMS 父窗口 ──
      const payload = JSON.stringify({ token, provider: "github" });
      const nonce = createCspNonce();
      return new Response(decapHandshakeHtml(payload, cmsOrigin, nonce), {
        headers: oauthHtmlHeaders(nonce),
      });
    }

    // ── 健康检查 / 默认页 ──
    const lines = [
      "OAuth proxy · zorotreeking",
      "",
      "Decap CMS:",
      "  GET /auth",
      "  GET /callback",
      "",
      "TrailLens 后端反代:",
      ...Object.entries(OAUTH_PROXY_ROUTES)
        .map(([path, route]) => `  ${route.methods.join("/")} ${path}  →  ${route.upstream}`),
    ];
    return new Response(lines.join("\n"), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};

/* ── 通用反代:保留 method/headers/body/query,剥掉 Host/CF-* ── */
async function proxyToUpstream(request, upstreamUrl, incomingUrl) {
  const target = new URL(upstreamUrl);
  target.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("Host");
  headers.delete("CF-Connecting-IP");
  headers.delete("CF-Ray");
  headers.delete("CF-Visitor");
  headers.delete("X-Forwarded-For");
  headers.delete("X-Real-IP");

  // GitHub API 强制要求 User-Agent
  if (upstreamUrl.startsWith("https://api.github.com") && !headers.has("User-Agent")) {
    headers.set("User-Agent", "zorotreeking-oauth-proxy");
  }

  const init = {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "manual",
  };

  try {
    const upstream = await fetch(target.toString(), init);
    const responseHeaders = new Headers(upstream.headers);
    // 该代理仅供后端调用：不继承上游 CORS 放行，也不缓存 OAuth 数据。
    responseHeaders.delete("Access-Control-Allow-Origin");
    responseHeaders.delete("Access-Control-Allow-Credentials");
    responseHeaders.delete("Access-Control-Expose-Headers");
    responseHeaders.delete("Set-Cookie");
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (e) {
    return new Response(`upstream_fetch_failed: ${e.message}`, {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function oauthError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": clearStateCookie(),
    },
  });
}

function stateCookie(value) {
  return `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/callback; Max-Age=${STATE_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function clearStateCookie() {
  return `${STATE_COOKIE}=; Path=/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function createCspNonce() {
  return crypto.randomUUID().replaceAll("-", "");
}

function oauthHtmlHeaders(nonce) {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
    "Set-Cookie": clearStateCookie(),
  };
}

function decapHandshakeHtml(payload, cmsOrigin, nonce) {
  // Decap CMS 通过 postMessage 协议接收 token，协议："authorization:github:success:<json>"
  //
  // 安全：targetOrigin 必须固定为 Decap CMS 部署域名，不能用 "*"——任何 opener
  // 都能截获 token。同时接收 "authorizing:github" 握手时必须校验 event.origin，
  // 防止恶意页面伪造握手骗取 token。
  const cmsOriginJson = JSON.stringify(cmsOrigin);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Authorizing…</title></head><body>
<p>正在登录…</p>
<script nonce="${nonce}">
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

function closingHtml(text, nonce) {
  const escaped = String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
  return `<!doctype html><html><body><p>${escaped}</p><script nonce="${nonce}">setTimeout(function(){window.close();},2500);</script></body></html>`;
}
