#!/bin/bash
cd /Users/liuzf/projects/stock_pusher
python3 main.py --now > /tmp/stock_output.log 2>&1
echo "done, check /tmp/stock_output.log"
