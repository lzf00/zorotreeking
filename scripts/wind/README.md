# Wind 市场数据 cron

每个交易日 10:30 / 15:30 BJT 通过 systemd timer 触发，调 Wind MCP CLI 抓数据：

- **开盘版 10:30** (`run_open.py`)：A 股大盘 + 自选股 → 微信推送（不归档）
- **收盘版 15:30** (`run_close.py`)：A 股 + 港股 + 单股深度 → 微信推送 + 归档到 `src/content/invest/market-recap-{date}.zh.mdx` + 写 `src/data/wind-*-latest.json` + git push 触发 deploy

宿主：**110.40.142.199 服务器 systemd timer**（不在 GitHub Actions，避免每次安装 wind-mcp-skill 依赖）。

## 文件结构

```
scripts/wind/
  fetcher.py        Wind MCP CLI 调用 + 数据聚合（fetch_all_data / build_report）
  publisher.py      写文件到 src/content/invest/ + src/data/ + git commit/push
  wechat.py         pushplus / Server酱 推送
  holidays.py       交易日历（每年 11~12 月更新次年）
  run_open.py       systemd 入口：开盘版
  run_close.py      systemd 入口：收盘版
  requirements.txt  python-dotenv（其余用标准库）
```

## 数据流

```
systemd wind-recap-{open,close}.timer  ──触发──▶  run_{open,close}.py
                                                   ├─ fetcher.fetch_all_data
                                                   │   └─ wind-mcp-skill CLI (node)
                                                   ├─ fetcher.build_report  → markdown
                                                   ├─ wechat.push_via_serverchan
                                                   └─ publisher.publish_to_zorotreeking
                                                       ├─ 写 src/content/invest/market-recap-*.mdx
                                                       ├─ 写 src/data/wind-*.json
                                                       └─ GitHub Git Data API 提交（走 api.github.com）
                                                           blob → tree → commit → ref
                                                                 │
                                                                 ▼
                                                       .github/workflows/deploy.yml
                                                       触发 rsync → /www/wwwroot/zorotreeking/dist
```

> **为什么走 API 而非 git push**：国内服务器 110.40.142.199 出口被墙 `github.com:443`（135s 超时），但 `api.github.com` 通（0.26s 200）。`publisher.py` 检测到 `GITHUB_TOKEN` 环境变量后自动改用 REST API 直接 commit 文件树，完全不依赖本地 git clone 也不需要 SSH 推送。开发机不设 `GITHUB_TOKEN` 则继续走本地 git push 模式。

## 服务器侧部署

依赖：node 18+、Python 3.9+、`~/.wind-aifinmarket/config`（Wind API key）、有写权限的 GitHub Personal Access Token。**无需 git clone zoro repo 到服务器**。

```bash
# 1. 装 wind-mcp-skill（纯文件，不是 npm package）
rsync -avz ~/.agents/skills/wind-mcp-skill/ root@110.40.142.199:/opt/wind-mcp-skill/

# 2. 拷 Wind API key
scp ~/.wind-aifinmarket/config root@110.40.142.199:~/.wind-aifinmarket/

# 3. 拷 cron 脚本（不需要 clone zoro repo）
rsync -avz scripts/wind/ root@110.40.142.199:/opt/wind-recap/

# 4. 装 Python 依赖
ssh root@110.40.142.199 'pip3 install python-dotenv'

# 5. 写 /opt/wind-recap/.env：
#    WIND_SKILL_DIR=/opt/wind-mcp-skill
#    STOCK_CODES=sh600519,...
#    HK_STOCK_CODES=01810.HK,...
#    SERVERCHAN_KEY=SCT...
#    GITHUB_TOKEN=ghp_...          ← 触发 API 模式
#    GITHUB_REPO=lzf00/zorotreeking
#    GITHUB_BRANCH=main

# 6. 配 systemd unit + timer（见下方）
```

## systemd 单元

```ini
# /etc/systemd/system/wind-recap-open.service
[Unit]
Description=Wind market recap (open, 10:30 BJT)
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/wind-recap
EnvironmentFile=/opt/wind-recap/.env
ExecStart=/usr/bin/python3 /opt/wind-recap/run_open.py
TimeoutSec=600

# /etc/systemd/system/wind-recap-open.timer
[Unit]
Description=Wind market recap (open) daily 10:30 BJT

[Timer]
OnCalendar=Mon..Fri *-*-* 02:30:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
```

收盘版同结构，OnCalendar 改 `Mon..Fri *-*-* 07:30:00 UTC`（15:30 BJT），ExecStart 改 `run_close.py`。

## 故障排查

| 现象 | 排查 |
|---|---|
| 微信收不到推送 | `journalctl -u wind-recap-close.service -n 50` |
| Wind 调用失败 | `cat ~/.wind-aifinmarket/config` 看 key、`WIND_SKILL_DIR=/opt/wind-mcp-skill node /opt/wind-mcp-skill/scripts/cli.mjs call stock_data get_indexes '{"index_codes":"000001.SH"}'` 手测 |
| GitHub API 推送失败 | 看 stderr；常见：token 过期 / scope 不含 `repo`；用 `curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/lzf00/zorotreeking` 验证 |
| Wind 单股深度数据缺失（quota 超限） | 主链路不阻断，等次日额度重置即可 |
| 非交易日还是触发 | `holidays.py STOCK_HOLIDAYS` 更新 |

## 节假日表更新

每年 11~12 月国务院发布次年节假日安排后，编辑 `holidays.py`：

```python
STOCK_HOLIDAYS = {
    # ... 历史 ...
    "2027-01-01", "2027-01-02", ...
}
```

A 股调休补班日不交易，无需维护补班列表。

## 历史

本目录从 `~/projects/stock_pusher.deprecated_20260602` 迁移而来（2026-05-29），原项目已归档到 `~/projects/.archive/`。

迁移目标：把"笔记本宿主 launchd cron + 跨 repo git push"简化为"服务器 systemd + 同 repo 写入"。
