# Home-PC daily SF/CUBE price fetch (ops)

The official history endpoint returns 403 to the VPS (LULU-153), so this PC fetches once a day and
ships only the increment. See `docs/IMPL_PLAN_SH47.md`.

Flow: `scripts/update.py` (fetch, unchanged) -> `scripts/export_increment.py` (last 3 days, gzip JSONL)
-> `ssh` with a dedicated forced-command key -> VPS `scripts/ingest_increment.py` (`INSERT OR IGNORE`
only, 4h re-derived) -> the driver judges the one-line JSON result.

Nothing in this folder has been registered, installed or run against the network by the implementer.
Every step below is for the user.

## 0. One-time: build the local DB (real network, ~884 requests, <= 40 min)

```
cd server\sf-history
python scripts\backfill.py      --db data\sf_price_history.sqlite
python scripts\cube_backfill.py --db data\sf_price_history.sqlite
sqlite3 data\sf_price_history.sqlite "PRAGMA integrity_check;"
```

Also confirm `python -m pytest tests/test_gen_item_list.py -q` is green after the backfill. `maxStar` is
derived from this DB, so before the backfill `test_build_item_list_derives_max_star_from_real_db` failing
with `assert None == 20` is normal. If it still fails after the backfill, that is a real anomaly: report it.

This also fills the gap since 2026-11-18. Check the gap is gone (expect 0 rows):

```
sqlite3 data\sf_price_history.sqlite "SELECT price_at, COUNT(*) AS combos FROM sf_price_history_hourly WHERE price_at >= '2026-11-18T15:00:00Z' GROUP BY price_at HAVING combos <> 748;"
```

## 1. One-time: dedicated transfer key (user only; never commit a private key)

1. On the PC: `ssh-keygen -t ed25519 -f %USERPROFILE%\.ssh\lulumi_sf_ingest -N ""`
   (the private key stays on the PC; do not paste it into chat, docs or logs).
2. On the VPS, put a forced-command wrapper `ingest_increment.sh` for `botuser` that (a) reads the gzip from stdin and runs the ingest, e.g. (adjust paths):
   ```
   #!/bin/sh
   exec /home/botuser/apps/lulumi-tools-sf-history/.venv/bin/python \
     /home/botuser/apps/lulumi-tools-sf-history/scripts/ingest_increment.py \
     --db /home/botuser/apps/lulumi-tools-sf-history/data/sf_price_history.sqlite
   ```
   The ingest ALWAYS snapshots the DB to `<db>.pre-ingest-<ts>` before inserting (default; only
   `--no-backup` disables it, so the wrapper cannot lose the safety net). It keeps the newest 1
   (`--backup-keep`); ~0.9 GiB of disk.
3. Add the PUBLIC key to `botuser`'s `authorized_keys` as one line with the restrictions:
   `command="/home/botuser/bin/ingest_increment.sh",restrict ssh-ed25519 AAAA... lulumi-sf-ingest`
4. Trust the host once: `ssh -i <key> botuser@163.44.118.206` (it will only run the forced command; the
   first call just records the host key). The driver uses `StrictHostKeyChecking=yes`.
5. Copy `scripts/ingest_increment.py` (and the modules it imports: `db.py`, `aggregate.py`,
   `cube_aggregate.py`, `schema.sql`; they already exist on the VPS) to the VPS deploy dir. No new listen port.

Set the key path for the scheduled task's user (persisted):

```
setx SF_DELIVER_SSH_KEY "%USERPROFILE%\.ssh\lulumi_sf_ingest"
```
(`SF_DELIVER_TARGET` defaults to `botuser@163.44.118.206`.)

## 2. Rehearse

```
cd server\sf-history
python ops\sf_daily_fetch.py --dry-run       # route/config only: no request, no export, no transfer
python ops\sf_daily_fetch.py --no-deliver    # fetch + export, nothing sent
```

First real delivery: the local DB has the 2026-11-18.. gap filled but the VPS does not, and the default
window is 3 days. Run it once by hand with a wider window so the VPS also gets the gap:

```
python ops\sf_daily_fetch.py --days 10
```
Re-sending is harmless: already-present rows are ignored (idempotent).

## 3. Register (once; needs no admin rights)

```
schtasks /create /tn LulumiSfDailyFetch /xml "C:\Users\pachi\Desktop\msu ranking\server\sf-history\ops\LulumiSfDailyFetch.xml"
Get-ScheduledTask -TaskName LulumiSfDailyFetch | Format-List State
Get-ScheduledTaskInfo -TaskName LulumiSfDailyFetch | Format-List NextRunTime,LastTaskResult
```
Expect `State : Ready` and `NextRunTime` = the next JST 17:00.

Do not add an `<?xml ... encoding="UTF-8"?>` declaration to the XML: Task Scheduler expects UTF-16 and
fails with "The task XML is malformed. (1,40)" (LULU-151).

Trigger: JST 17:00 daily from 2026-11-26 (the PC time zone must be JST). Requires: user logged on, PC awake
(WakeToRun).

## Check / run / remove

```
schtasks /query /tn LulumiSfDailyFetch /v /fo list
schtasks /run /tn LulumiSfDailyFetch
schtasks /delete /tn LulumiSfDailyFetch /f
```

## Logs and failure signal

- Log: `server/sf-history/logs/sf_daily_fetch_<yyyy-MM-dd>.log` (and `increment_<date>.jsonl.gz`)
- On failure: `%USERPROFILE%\Desktop\LULUMI_SF_FETCH_FAILED_<yyyy-MM-dd>.txt` (one-line reason + log path);
  removed by the next successful run of the same day.

## When it fails

1. Read the marker, then the log.
2. `update.py exit 2/3`: the safety net fired (403 / 429 / budget). Nothing was sent. If the log shows a 403
   or a maintenance page, STOP and report (the plan's premise, that this PC is not blocked, would be broken).
   Otherwise tomorrow's window grows by itself; no gap results.
3. `ssh/ingest exit N` or `integrity=...`: if the VPS says integrity is not `ok`, restore
   `<db>.pre-ingest-<ts>` and `systemctl restart sf-history.service`.
4. A day the PC is off is simply a 1-day-later catch-up (windows grow). A PC off for more than ~150 days
   would exceed upstream retention.

## VPS-side recommendation (user's call; not done)

`sf-history-update.timer` fails every 4 hours under the 403 and keeps `systemctl --failed` dirty. The plan
recommends stopping it (`systemctl disable --now sf-history-update.timer`; `enable --now` restores it).
