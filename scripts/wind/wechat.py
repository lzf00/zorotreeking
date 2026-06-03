"""
微信推送模块
支持 pushplus / Server酱
统一使用 urllib 标准库

SSL 校验默认开启（生产 OpenSSL 都正常）；
仅当 SKIP_SSL_VERIFY=1 时关闭（兼容 macOS 老 LibreSSL 等特殊环境）。
"""

import json
import logging
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request


log = logging.getLogger("wind.wechat")
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(_h)
log.setLevel(logging.INFO)


def _make_ssl_ctx() -> ssl.SSLContext:
    """默认开 SSL 校验（防 MITM）；SKIP_SSL_VERIFY=1 显式关闭"""
    ctx = ssl.create_default_context()
    if os.environ.get("SKIP_SSL_VERIFY", "").strip() == "1":
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        log.warning("⚠️  SSL_VERIFY 已关闭（SKIP_SSL_VERIFY=1）—— 仅推荐 macOS LibreSSL 调试时用")
    return ctx


SSL_CTX = _make_ssl_ctx()


def _do_post(url: str, body: bytes, content_type: str, timeout: int) -> dict:
    """POST 并解析 JSON 响应；HTTP 错误时也尝试读 response body 拿真正报错"""
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": content_type},
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX)
        text = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        # HTTPError 也能读 body —— Server酱 / pushplus 会在 body 里写真错误
        try:
            err_body = e.read().decode("utf-8", errors="replace")
        except Exception:
            err_body = ""
        raise RuntimeError(f"HTTP {e.code}: {err_body[:500] or e.reason}") from e
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}


def _http_post_json(url: str, payload: dict, timeout: int = 30) -> dict:
    """POST JSON，返回解析后的 dict（失败抛异常）"""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return _do_post(url, body, "application/json; charset=utf-8", timeout)


def _http_post_form(url: str, payload: dict, timeout: int = 30) -> dict:
    """POST form-urlencoded（Server酱 SCT 推荐方式）"""
    body = urllib.parse.urlencode(payload, encoding="utf-8").encode("utf-8")
    return _do_post(url, body, "application/x-www-form-urlencoded; charset=utf-8", timeout)


def push_via_pushplus(token: str, title: str, content: str) -> bool:
    """
    通过 pushplus 推送消息到微信
    注册地址: https://www.pushplus.plus/
    """
    url = "http://www.pushplus.plus/send"
    payload = {
        "token": token,
        "title": title,
        "content": content,
        "template": "html",
    }
    try:
        data = _http_post_json(url, payload)
        if data.get("code") == 200:
            log.info(f"✅ pushplus 推送成功: {title}")
            return True
        log.error(f"❌ pushplus 推送失败: {data.get('msg', '未知错误')}")
        return False
    except Exception as e:
        log.error(f"❌ pushplus 推送异常: {e}")
        return False


def push_via_serverchan(key: str, title: str, content: str) -> bool:
    """
    通过 Server酱 推送消息到微信
    注册地址: https://sct.ftqq.com/
    SCT 官方推荐 form-urlencoded；某些 markdown 在 JSON 模式下会触发 400。
    """
    url = f"https://sctapi.ftqq.com/{key}.send"
    payload = {"title": title, "desp": content}
    try:
        data = _http_post_form(url, payload)
        if data.get("code") == 0:
            d = data.get("data", {}) or {}
            pushid = d.get("pushid", "")
            readkey = d.get("readkey", "")
            log.info(f"✅ Server酱 已提交: {title} (pushid={pushid})")
            if pushid and readkey:
                log.info(f"   查推送状态: https://sct.ftqq.com/message/{pushid}/{readkey}.html")
            return True
        log.error(f"❌ Server酱 推送失败: {data}")
        return False
    except Exception as e:
        log.error(f"❌ Server酱 推送异常: {e}")
        return False
