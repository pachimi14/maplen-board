# Home-PC daily fetch (ops)

Official ranking API returns 403 to GitHub Actions / VPS (LULU-150), so this PC fetches
and GitHub only publishes. See `docs/IMPL_PLAN_local-daily-fetch.md`.

Flow: preflight -> already-published check -> Release `db-store` download -> `main.py` ->
fail-closed gates -> Release merge-write -> `gh workflow run maplen-board-pages.yml` -> wait for site.
The PC never touches git (no push).

## Register (user action, once; run in a normal terminal)

```
schtasks /create /tn LulumiDailyFetch /xml "C:\Users\pachi\Desktop\msu ranking\exp_ranking\bot\ops\LulumiDailyFetch.xml"
```

Triggers: JST 09:05 / 13:00 / 20:00 daily (the PC time zone must be JST). Later runs of the
same day exit in seconds when the site already serves the day. Requires: user logged on,
`gh auth login` done (scopes repo + workflow), PC awake (task has WakeToRun).

## Check / run / remove

```
schtasks /query /tn LulumiDailyFetch /v /fo list
schtasks /run /tn LulumiDailyFetch
schtasks /delete /tn LulumiDailyFetch /f
```

Safe rehearsal (no API request, no Release write, no dispatch):
`cd exp_ranking\bot && python daily_fetch.py --dry-run`

## Logs and failure signal

- Log: `exp_ranking/bot/logs/daily_fetch_<yyyy-MM-dd>.log`
- On failure: `%USERPROFILE%\Desktop\LULUMI_FETCH_FAILED_<ranking_day>.txt` (one-line reason + log path).
  Removed automatically by the next successful run for that day.

## When it fails

1. Read the marker, then the log.
2. `env parity test failed`: CI env block and `production.env` diverged. Make them identical
   (`python -m pytest test_production_env_parity.py -q` shows which key). Never edit `.env` to hide it.
3. `gates failed, Release NOT written`: nothing was written; fix cause and re-run `schtasks /run`.
4. 403 / maintenance from the official API: nothing to do locally; the 13:00 / 20:00 runs retry.
   A ranking_day can only be recovered for ~24h after JST 09:05 (LULU-139).
5. Run ended `cancelled`: the driver re-dispatches up to 2 times (concurrency with the cron runs).
