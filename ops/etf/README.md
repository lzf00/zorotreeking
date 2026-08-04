# ETF self-detection and self-operations

This directory is the production contract for the ETF realtime API and the
three-factor pipeline. It deliberately separates detection, deterministic
repair, and deployment rollback.

## Data flow

1. `src/data/etf-registry.json` is copied to
   `/opt/zoro-etf-ops/registry.json`. The realtime API, pipeline runner,
   publisher, frontend, and CI all consume the same 12-code registry.
2. `pipeline_runner.py` injects the registry into the legacy analyzer, adds
   schema-v2 source identity, independently recomputes the contract, and writes
   JSON atomically.
3. `publish_etf.py` publishes an early snapshot only to
   `etf-three-factor-early-latest.json`. A complete 12/12 snapshot also updates
   `etf-three-factor-complete-latest.json` and the legacy last-known-good path.
4. `guardian.py` checks the realtime API and analyzer workspace every two
   minutes. Its independent CSI 300 calendar check prevents Monday/holiday
   fallback errors.
5. FastAPI exposes a safe public summary at `/api/market/etf/health` and an
   authenticated history at `/api/admin/etf-ops`.

## Repair policy

The guardian can only execute these allowlisted runbooks:

| Condition | Action | Limit |
| --- | --- | --- |
| Data contract fails | Retry data fetch | 2 per 5 minutes |
| Retry still fails | Reset only ETF market cache | 1 per 30 minutes |
| API cannot be reached | Restart `ai-agent.service` | 1 per 30 minutes |
| Complete snapshot is still invalid after 19:40 | Start `etf-three-factor.service` | 1 per 30 minutes |

It cannot stop services, restart Nginx, change configuration, or execute an
arbitrary command. `flock` prevents concurrent guardians. Every detection,
incident, and repair is persisted in `/var/lib/zoro-etf-ops/state.db`.

ServerChan uses the existing `/opt/wind-recap/.env`. Feishu can be enabled by
adding `ETF_FEISHU_WEBHOOK_URL` to `/opt/zoro-etf-ops/.env`; no secret belongs
in this repository.

## Verification

```bash
python3 -m unittest discover -s ops/etf/tests -v
npm run validate:etf
npm run verify
```

Production checks:

```bash
systemctl status etf-guardian.timer ai-agent etf-three-factor.timer
curl -fsS https://www.zorotreeking.online/api/market/etf/health
journalctl -u etf-guardian.service -n 50 --no-pager
```

## Rollback

The static deploy workflow writes each commit to `releases/<sha>`, changes the
`current` symlink atomically, verifies `/deploy-meta.json` and ETF API quality,
then switches back to `previous` automatically on failure.

Production service backups retain a timestamp suffix. Restore the matching
backup only after validating its exact path, run `systemctl daemon-reload`, and
verify the public health endpoint before declaring rollback complete.
