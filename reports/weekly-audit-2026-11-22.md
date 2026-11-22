# 每周巡检 2026-11-22

触发方式：部署时补跑（cron 为什么不靠谱见 scripts/weekly-audit.mjs 顶部注释）。

| 检查 | 结果 | 耗时 |
|---|---|---|
| 行情/宏观快照年龄 | 通过 | 0.1s |
| 内容更新节奏 | 通过 | 0.1s |
| 站外链接体检（分批） | 通过 | 0.8s |
| 无障碍（完整 64 项） | 通过 | 221.7s |

## 行情/宏观快照年龄

```
      "stale": false
    },
    {
      "file": "etf-three-factor-latest.json",
      "label": "ETF 三因子分析",
      "ageDays": 2,
      "maxAgeDays": 5,
      "stale": false
    }
  ],
  "stale": []
}
```

## 内容更新节奏

```
| --- | --- | --- | --- | --- |
| AI 日报 | 2026-11-22 | 0 天 | 380 | ✅ |
| 投资日报 | 2026-11-22 | 0 天 | 380 | ✅ |
| 投资复盘 | 2026-11-20 | 0 天 | 244 | ✅ |

内部断档（这些日期该有产出但没有）：
- AI 日报 2026-11-20（窗口已过，补不回来，仅记录）
- 投资日报 2026-11-20（窗口已过，补不回来，仅记录）
- AI 日报 2026-11-19（已错过良久，仅记录）
- 投资日报 2026-11-19（已错过良久，仅记录）

内容流水线正常
```

## 站外链接体检（分批）

```
    "blocked": 0,
    "suspect": 0,
    "error": 0,
    "skipped": 0
  },
  "dead": [],
  "suspect": [],
  "byHost": [],
  "checked": 900,
  "total": 900
}
外链 900 条 · 缓存命中 900 · 待抓 0
```

## 无障碍（完整 64 项）

```
✓ light /now/
✓ dark  /now/
✓ light /guestbook/
✓ dark  /guestbook/
✓ light /en/guestbook/
✓ dark  /en/guestbook/
✓ light /en/invest/market-recap-2026-11-13/
✓ dark  /en/invest/market-recap-2026-11-13/
✓ light /hike/sample-route/
✓ dark  /hike/sample-route/

64 次检查：0 失败 / 0 警告（--fail-on=error）→ a11y-report.json
```
