#!/bin/bash
# Mac launchd 一键安装（路径自动检测）
#
# 安装到 ~/Library/LaunchAgents/，每个交易日 10:30 / 15:30 自动触发推送。
# VPS 部署见 docs/VPS_DEPLOY.md（用 cron 不用 launchd）。

set -e

# 自动检测脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRON_PUSH="$SCRIPT_DIR/cron_push.sh"
LOG_OUT="$SCRIPT_DIR/push.log"
LOG_ERR="$SCRIPT_DIR/push_error.log"

echo "🔧 安装 Zoro AI 股票定时推送..."
echo "   工作目录: $SCRIPT_DIR"

chmod +x "$CRON_PUSH"

# 上午 10:30
cat > ~/Library/LaunchAgents/com.zoroai.stock-morning.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.zoroai.stock-morning</string>
    <key>ProgramArguments</key>
    <array>
        <string>$CRON_PUSH</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>10</integer>
        <key>Minute</key>
        <integer>30</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_OUT</string>
    <key>StandardErrorPath</key>
    <string>$LOG_ERR</string>
</dict>
</plist>
EOF

# 下午 15:30
cat > ~/Library/LaunchAgents/com.zoroai.stock-afternoon.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.zoroai.stock-afternoon</string>
    <key>ProgramArguments</key>
    <array>
        <string>$CRON_PUSH</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>15</integer>
        <key>Minute</key>
        <integer>30</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_OUT</string>
    <key>StandardErrorPath</key>
    <string>$LOG_ERR</string>
</dict>
</plist>
EOF

launchctl unload ~/Library/LaunchAgents/com.zoroai.stock-morning.plist 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/com.zoroai.stock-afternoon.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.zoroai.stock-morning.plist
launchctl load ~/Library/LaunchAgents/com.zoroai.stock-afternoon.plist

echo "✅ 定时任务已安装并加载"
echo "📅 每个工作日 10:30 + 15:30 自动推送"
echo ""
echo "查看任务: launchctl list | grep zoroai"
echo "查看日志: tail -f $LOG_OUT"
echo ""
echo "⚠️  macOS 沙箱：launchd 写入 ~/Documents 需在「系统设置→隐私与安全→完整磁盘访问」"
echo "    给 /bin/bash + /usr/bin/python3 + node 授权。生产环境推荐迁到 VPS（见 docs/VPS_DEPLOY.md）。"
