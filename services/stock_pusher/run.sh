#!/bin/bash
# Zoro AI 股票助手 - 启动脚本

cd "$(dirname "$0")"

# 检查 Python 环境
if ! command -v python3 &> /dev/null; then
    echo "❌ 未找到 python3"
    exit 1
fi

# 安装依赖
echo "📦 检查并安装依赖..."
pip3 install -r requirements.txt -q

# 启动
echo "🚀 启动 Zoro AI 股票助手..."
python3 main.py "$@"
