# stock_pusher VPS 部署指南

> 把 stock_pusher 从 Mac 迁到 VPS 跑，解决 macOS Documents 沙箱权限 + Mac 必须开机两个痛点。

## 0. 前置条件

- VPS：Linux（Ubuntu / Debian / CentOS 都行），**北京时间** timezone（关键，定时任务靠这个）
- 已装：`git` `python3` (>=3.9) `node` (>=20，推荐 22)
- VPS 上有 SSH key 能 push 到 GitHub（README 提到部署链路已用 `SSH_DEPLOY_KEY`，但**那是 rsync 接收 key**，git push 需要另一把）
- WIND_API_KEY 一份（从 https://aifinmarket.wind.com.cn/#/user/overview 获取）

## 1. 时区检查

```bash
# 必须是 Asia/Shanghai
timedatectl | grep "Time zone"

# 如果不是，改：
sudo timedatectl set-timezone Asia/Shanghai
```

## 2. 装 node 22（如未装）

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS / RHEL
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs

# 验证
node -v   # v22.x
npm -v
```

## 3. 装 Python 依赖

```bash
sudo apt-get install -y python3 python3-pip python3-venv   # Debian/Ubuntu
# 或: sudo dnf install -y python3 python3-pip               # CentOS/RHEL
```

## 4. 装 wind-mcp-skill（全局）

```bash
# Gitee 源（国内 VPS 快）
npx skills add https://gitee.com/wind_info/wind-skills.git --skill wind-mcp-skill -g -y

# 或 GitHub 源（海外 VPS）
# npx skills add Wind-Information-Co-Ltd/wind-skills --skill wind-mcp-skill -g -y

# 配置 API Key（替换 ak_XXX）
cd ~/.agents/skills/wind-mcp-skill
node scripts/cli.mjs setup-key ak_XXX --scope global

# 验证（应返回茅台行情）
node scripts/cli.mjs call stock_data get_stock_price_indicators '{"windcode":"600519.SH","indexes":"中文简称,最新成交价"}'
```

## 5. 克隆 zorotreeking + 配 git push 凭据

### 5.1 准备 SSH key（如 VPS 没有可 push 的 key）

```bash
# 生成新 key（如果还没有）
ssh-keygen -t ed25519 -C "vps-stock_pusher@zoro" -f ~/.ssh/zoro_push -N ""

# 打印公钥，加到 GitHub Settings → SSH and GPG keys
cat ~/.ssh/zoro_push.pub
```

### 5.2 配置 SSH config

```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com-zoro
  HostName github.com
  User git
  IdentityFile ~/.ssh/zoro_push
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

### 5.3 克隆 repo

```bash
cd ~
git clone git@github.com-zoro:lzf00/zorotreeking.git
cd zorotreeking

# 配置 git user（commit signature 用）
git config user.email "vps@zoro.local"
git config user.name "VPS Stock Pusher"
```

## 6. 装 stock_pusher 依赖

```bash
cd ~/zorotreeking/services/stock_pusher

# 创建 venv（推荐）
python3 -m venv .venv
source .venv/bin/activate

# 装依赖
pip install -r requirements.txt
```

## 7. 配置 .env

```bash
cp .env.example .env
nano .env

# 填入：
#   SERVERCHAN_KEY=<你的 Server酱 key>
#   STOCK_CODES=600519.SH,601318.SH,...
#   HK_STOCK_CODES=01810.HK,00700.HK,...
#   PUSH_TIMES=10:30,15:30
```

## 8. 手动跑一次验证

```bash
cd ~/zorotreeking/services/stock_pusher
source .venv/bin/activate

# --now 立即执行一次（不等定时）
python3 main.py --now

# 应该看到：
#   ✅ Server酱 已提交  （收到微信推送）
#   📝 zorotreeking_publisher: 已写入 4 个文件
#   ✅ zorotreeking_publisher: 已推送到 zorotreeking
```

如失败：
- `AUTH_ERROR` → setup-key 没配好
- 写文件失败 → 检查 zorotreeking 目录权限
- git push 失败 → 检查 SSH key

## 9. 设置 crontab 定时任务

```bash
crontab -e

# 加入两行（10:30 + 15:30 北京时间，工作日；周末由 is_trading_day() 自动跳过）
30 10 * * 1-5 /home/<user>/zorotreeking/services/stock_pusher/cron_push.sh
30 15 * * 1-5 /home/<user>/zorotreeking/services/stock_pusher/cron_push.sh
```

⚠️ **cron_push.sh 已自动 cd 到脚本所在目录，无需写绝对路径在脚本里**。但 crontab 里要给绝对路径。

> 注意：cron 用 `venv/bin/python3` 比 `/usr/bin/python3` 干净。修改 `cron_push.sh`：
> ```bash
> # 让 cron_push.sh 优先用 venv
> PY="$SCRIPT_DIR/.venv/bin/python3"
> [ -x "$PY" ] || PY="$(command -v python3)"
> "$PY" main.py --now >> push.log 2>&1
> ```

## 10. 验证 cron

```bash
# 查看 cron 任务
crontab -l

# 等到下一个 10:30 / 15:30 后看日志
tail -f ~/zorotreeking/services/stock_pusher/push.log

# 系统 cron 日志
grep CRON /var/log/syslog | tail -20
```

## 11. 关闭 Mac launchd（确认 VPS 跑通后）

回 Mac：

```bash
launchctl unload ~/Library/LaunchAgents/com.zoroai.stock-morning.plist
launchctl unload ~/Library/LaunchAgents/com.zoroai.stock-afternoon.plist
rm ~/Library/LaunchAgents/com.zoroai.stock-{morning,afternoon}.plist
```

避免两边同时推（双推一次微信、两次 git commit 撞车）。

## 12. 故障排查 cheatsheet

| 症状 | 原因 | 修复 |
|------|------|------|
| `[AUTH] 超过当天发送次数限制` | Server酱免费版 5/天 | 升级 SCT 或换 PushPlus（200/天） |
| `AUTH_ERROR: Key 未配置` | wind-mcp-skill 没 setup-key | `cli.mjs setup-key ak_XXX --scope global` |
| `git push` 403 | SSH key 没加到 GitHub | 重看 §5 |
| `Permission denied (publickey)` | SSH config 没生效 | `ssh -T git@github.com-zoro` 测连接 |
| `并发请求次数超限` | Wind 后端限流 | 已有 retry，多数自动恢复；下次 cron 重试 |
| cron 不触发 | cron 服务没启 | `sudo systemctl enable --now cron` |
| 推送数据但 zorotreeking 没更新 | CI 没触发 | 看 GitHub Actions 是否成功 |

## 13. 监控建议（可选）

如果你想监控 cron 是否成功跑：

```bash
# 在 cron_push.sh 末尾加一行，成功推送后 ping 一个监控服务（如 healthchecks.io）
[ $? -eq 0 ] && curl -fsS -m 10 --retry 3 https://hc-ping.com/<uuid> > /dev/null
```

---

部署完不忘**关闭 Mac launchd**，避免双推。
