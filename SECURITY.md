# Security Policy

## Reporting a Vulnerability

发现安全问题请**不要在 GitHub Issues 公开**，直接邮件联系：

- **邮箱**：见线上 [`/contact`](https://www.zorotreeking.online/contact)
- **响应时限**：48 小时内首次回复，紧急问题（已被利用、数据泄露）尽快处理
- **PGP**：暂未启用，必要时可在邮件里要求切换加密通道

报告时请尽量提供：

1. 漏洞类型与潜在影响
2. 复现步骤（截图 / curl 命令 / 测试 payload 都行）
3. 你建议的修复方向（可选）

不会对负责任披露的报告人提起任何法律或运营层面追究。

---

## What's in scope

- 主站 `https://www.zorotreeking.online`（与 4 子域）
- `/api/*` FastAPI 后端
- Decap CMS 后台（`/admin/`）+ OAuth Worker
- 构建工件（GitHub Actions、daily-digest cron）

## What's out of scope

- 站点上引用的第三方资源（Google Fonts / unpkg / jsdelivr 等），请直接报告给上游
- 已在隐私政策中明示收集的数据（IP 指纹、PV 统计等）
- 社工 / 物理攻击 / 钓鱼负责人邮箱本身
- 对 SQLite 之类标准组件未公开 CVE 的猜测

## Hall of Fame

合理报告 + 协助验证后会在此致谢（征得报告人同意后）。
