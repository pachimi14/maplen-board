#!/usr/bin/env bash
# Dispatches the MapleN Board Pages workflow from the VPS ("press the
# button" trigger -- docs/IMPL_PLAN_vps-trigger.md §2.4/§4).
#
# This script does exactly one thing: POST one workflow_dispatch request.
# All fetching, DB, Release persistence, snapshot-guard, etc. stay entirely
# on the GitHub Actions side -- nothing about the ranking pipeline is
# duplicated here (§2.4 "VPS の役割は「ボタンを押す」だけ").
#
# Required environment (never hardcode, never print/log the value):
#   GITHUB_DISPATCH_PAT               fine-grained PAT, scoped to a single
#                                      repo, "Actions: Read and write" only
#                                      (README.md "PAT setup")
#
# Optional environment (defaults shown):
#   GITHUB_DISPATCH_REPO=pachimi14/maplen-board
#   GITHUB_DISPATCH_WORKFLOW=maplen-board-pages.yml
#   GITHUB_DISPATCH_REF=main
#   GITHUB_DISPATCH_WAIT_FOR_UPDATE=true    # workflow_dispatch input wait_for_update
#   GITHUB_DISPATCH_FORCE_FETCH=false       # workflow_dispatch input force_fetch
#
# Exit codes:
#   0   dispatch accepted (HTTP 204/200)
#   1   misconfiguration (missing PAT, missing curl, ...)
#   2   PAT rejected/expired (HTTP 401/403) -- this is the "quiet failure"
#       class (README.md "PAT 失効の検知"): if nobody notices, the VPS
#       primary path silently stops firing and the site falls back to the
#       GitHub cron schedule alone. Check with `systemctl --failed` /
#       `journalctl -u vps-trigger-dispatch.service` on the VPS.
#   3   any other HTTP status (network layer already surfaced by `set -e`
#       + curl's own non-zero exit for connection failures)
set -euo pipefail

: "${GITHUB_DISPATCH_REPO:=pachimi14/maplen-board}"
: "${GITHUB_DISPATCH_WORKFLOW:=maplen-board-pages.yml}"
: "${GITHUB_DISPATCH_REF:=main}"
: "${GITHUB_DISPATCH_WAIT_FOR_UPDATE:=true}"
: "${GITHUB_DISPATCH_FORCE_FETCH:=false}"

if [ -z "${GITHUB_DISPATCH_PAT:-}" ]; then
  echo "dispatch_pages_workflow: GITHUB_DISPATCH_PAT is not set (refusing to run)" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "dispatch_pages_workflow: curl not found" >&2
  exit 1
fi

url="https://api.github.com/repos/${GITHUB_DISPATCH_REPO}/actions/workflows/${GITHUB_DISPATCH_WORKFLOW}/dispatches"
payload=$(cat <<JSON
{"ref":"${GITHUB_DISPATCH_REF}","inputs":{"force_fetch":"${GITHUB_DISPATCH_FORCE_FETCH}","wait_for_update":"${GITHUB_DISPATCH_WAIT_FOR_UPDATE}"}}
JSON
)

# -sS: silent but still surface curl-level errors (DNS/network failure).
# Never add -v/--trace/--include here: those would echo the Authorization
# header (i.e. the PAT) to stdout/stderr, which this script must not do.
# -o discards the response body (GitHub returns 204 with no body on
# success; the only thing this script decides on is the status code, not
# the body). -w prints just the HTTP status code, nothing else.
http_status=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer ${GITHUB_DISPATCH_PAT}" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  --data "${payload}" \
  "${url}")

echo "dispatch_pages_workflow: HTTP ${http_status} (repo=${GITHUB_DISPATCH_REPO} workflow=${GITHUB_DISPATCH_WORKFLOW} ref=${GITHUB_DISPATCH_REF} wait_for_update=${GITHUB_DISPATCH_WAIT_FOR_UPDATE} force_fetch=${GITHUB_DISPATCH_FORCE_FETCH})"

case "${http_status}" in
  204|200)
    exit 0
    ;;
  401|403)
    echo "dispatch_pages_workflow: PAT rejected (HTTP ${http_status}) -- likely expired or revoked. Rotate GITHUB_DISPATCH_PAT; see README.md 'PAT 失効の検知'." >&2
    exit 2
    ;;
  *)
    echo "dispatch_pages_workflow: unexpected HTTP ${http_status}" >&2
    exit 3
    ;;
esac
