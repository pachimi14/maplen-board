# VPS Trigger -- `server/vps-trigger/`

docs/IMPL_PLAN_vps-trigger.md (問題A: GitHub の schedule 遅延/ドロップ対策).
**The VPS's only job is to press the button.** This directory ships exactly
one script that fires a `workflow_dispatch` POST at a fixed time every day;
everything else -- fetching the official ranking, SQLite, Release
persistence, snapshot-guard, deploy -- stays entirely on the GitHub Actions
side, unchanged. The GitHub `schedule` cron (4 runs/day, `.github/workflows/
maplen-board-pages.yml`) is kept as-is and remains the fallback if the VPS
is down (multi-layer defense, not a replacement).

This directory is **not deployed by this commit**. Shipping the code/examples
here has zero production effect until a human completes the VPS-side setup
below (§4 of the plan explicitly assigns that to the user, not the
implementer/orchestrator).

## Files

```text
dispatch_pages_workflow.sh           the only thing that actually runs on the VPS: POSTs one
                                      workflow_dispatch request, nothing else (see its own header
                                      comment for env vars / exit codes)
deploy/vps-trigger-dispatch.service.example   systemd oneshot unit (same discipline as
                                               server/sf-history/deploy/*.service.example)
deploy/vps-trigger-dispatch.timer.example     fires the service daily at JST 09:06
```

## What it does (and does not do)

```bash
curl -sS -X POST -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $GITHUB_DISPATCH_PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/pachimi14/maplen-board/actions/workflows/maplen-board-pages.yml/dispatches \
  -d '{"ref":"main","inputs":{"force_fetch":"false","wait_for_update":"true"}}'
```

- `wait_for_update=true` (the default `dispatch_pages_workflow.sh` sends) makes the
  dispatched run wait for the official rebuild to finish before fetching
  (`ENFORCE_JST_FETCH_WINDOW`, see the workflow's env block) -- the whole
  point of running from a fixed VPS clock instead of just curling ad hoc.
- Double-fire is harmless: if today's ranking day is already captured (e.g.
  a GitHub cron run beat the VPS to it, or vice versa), the dispatched run
  exits early via `Ranking day ... already captured; skipping` in ~20s
  (verified in production 2026-08-28) rather than re-fetching.
- This script never touches SQLite, the Release Asset, or the site build.
  It has no access to any of that -- the PAT it needs only has to be able to
  start a workflow run (see PAT scope below).

## PAT setup (user-only step -- do not share the value with any agent)

1. GitHub -> Settings -> Developer settings -> **Fine-grained personal
   access tokens** -> Generate new token.
   - **Repository access**: only `pachimi14/maplen-board` (not "all
     repositories").
   - **Permissions**: **Actions: Read and write** only. Nothing else
     (contents, metadata default-read is fine/required, but do not grant
     contents:write -- this script never needs to touch repo contents).
   - **Expiration**: fine-grained PATs expire after at most 1 year. Record
     the expiry date somewhere you'll actually see it (calendar reminder,
     not just GitHub's own list) -- see "PAT 失効の検知" below for what
     happens if you don't rotate it in time.
2. Copy the token value **once**, immediately into the env file below. Do
   not paste it into shell history, a repo file, an issue, a chat, or hand
   it to any agent/assistant.

## Deploy on the VPS

```bash
# 1. App directory + script
sudo mkdir -p /home/botuser/apps/lulumi-tools-vps-trigger
sudo cp server/vps-trigger/dispatch_pages_workflow.sh \
  /home/botuser/apps/lulumi-tools-vps-trigger/
sudo chmod +x /home/botuser/apps/lulumi-tools-vps-trigger/dispatch_pages_workflow.sh
sudo chown -R botuser:botuser /home/botuser/apps/lulumi-tools-vps-trigger

# 2. Secret env file -- root-only readable, PAT lives ONLY here, never in git.
sudo install -d -m 0755 /etc/lulumi-tools
sudo tee /etc/lulumi-tools/github-dispatch.env >/dev/null <<'EOF'
GITHUB_DISPATCH_PAT=__REPLACE_WITH_YOUR_FINE_GRAINED_PAT__
EOF
sudo chmod 600 /etc/lulumi-tools/github-dispatch.env
sudo chown root:root /etc/lulumi-tools/github-dispatch.env

# 3. systemd unit + timer (same flow as server/sf-history's *.example files)
sudo cp server/vps-trigger/deploy/vps-trigger-dispatch.service.example \
  /etc/systemd/system/vps-trigger-dispatch.service
sudo cp server/vps-trigger/deploy/vps-trigger-dispatch.timer.example \
  /etc/systemd/system/vps-trigger-dispatch.timer
# If the VPS is not running in UTC, edit OnCalendar in the .timer unit first
# (see the comment inside vps-trigger-dispatch.timer.example).
sudo systemctl daemon-reload
sudo systemctl enable --now vps-trigger-dispatch.timer

# 4. Manual smoke test (does a real dispatch -- only run this once you're
#    ready to trigger an actual workflow run):
sudo systemctl start vps-trigger-dispatch.service
sudo systemctl status vps-trigger-dispatch.service
sudo journalctl -u vps-trigger-dispatch.service -n 20
```

## PAT 失効の検知 ("quiet failure" detection)

A fine-grained PAT expires (max 1 year) or can be revoked. If that happens
and nobody notices, the VPS trigger silently stops firing and the site
quietly falls back to the GitHub cron schedule alone (still working, but
back to the schedule-drop risk this plan exists to reduce) -- a "静かな異
常" (silent failure) with no user-visible symptom on lulumi-tools.com itself.

`dispatch_pages_workflow.sh` makes this detectable, not silent:

- On HTTP 401/403 it prints a one-line diagnostic to stderr (never the PAT
  value) and exits with **code 2**, distinct from other failure modes (1 =
  misconfigured, 3 = other HTTP error).
- A non-zero exit marks the systemd unit **failed**, which is checkable
  without any extra tooling:
  ```bash
  systemctl --failed                              # lists vps-trigger-dispatch.service if it failed
  journalctl -u vps-trigger-dispatch.service -n 20 # shows the HTTP status + diagnostic line
  ```
- Recommended (optional, not required by this plan): point any monitoring
  you already run at `systemctl --failed` (e.g. a daily cron/health-check
  script, or `OnFailure=` in the `.service` unit pointing at a notification
  unit) so a 401/403 surfaces somewhere you'll actually see it, not just in
  `journalctl` waiting to be read.
- When you do see a 401/403: rotate the PAT (repeat "PAT setup" above),
  replace only the value in `/etc/lulumi-tools/github-dispatch.env`, then
  `sudo systemctl start vps-trigger-dispatch.service` to confirm it now
  exits 0.

## Rollback

Stop and disable the timer; the GitHub cron schedule (4 runs/day) continues
unchanged and is unaffected by anything in this directory.

```bash
sudo systemctl disable --now vps-trigger-dispatch.timer
```
