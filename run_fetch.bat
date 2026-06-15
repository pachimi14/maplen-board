@echo off
setlocal EnableExtensions
cd /d "%~dp0exp_ranking\bot"

title MapleN Board - Fetch

echo ========================================
echo  Fetch  (API -^> SQLite + rankings.json)
echo ========================================
echo   Same defaults as GitHub Actions.
echo.

if exist ".venv\Scripts\python.exe" (
    set "PYTHON=.venv\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

set "RANKING_MIN_LEVEL=225"
set "RANKING_MAX_PAGES=800"
set "RANKING_REQUEST_DELAY_SEC=0.35"
set "SNAPSHOT_RETENTION_DAYS=35"
set "MVP_HISTORY_DAYS=35"
set "MVP_EXPORT_TOP_N=0"
set "SQLITE_DB_PATH=data/ranking.db"
set "MVP_JSON_OUTPUT_PATH=../web/public/data/rankings.json"
set "NAVIGATOR_REQUEST_DELAY_SEC=0.35"
set "NAVIGATOR_FETCH_ENABLED=true"
set "NAVIGATOR_ROTATION_ENABLED=true"
set "NAVIGATOR_ROTATION_EPOCH=2026-06-12"
set "SKIP_RUN_IF_RANKING_DAY_EXISTS=true"
rem set "FORCE_RANKING_FETCH=true"

"%PYTHON%" main.py
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if %EXIT_CODE% equ 0 (
    echo [OK] Done. Open UI: ..\..\run_local_dev.bat --no-sync
) else (
    echo [ERROR] exit code=%EXIT_CODE%
)
echo.
pause
exit /b %EXIT_CODE%
