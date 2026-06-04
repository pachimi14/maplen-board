@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MapleN Board - Enrich Navigator

if exist ".venv\Scripts\python.exe" (
    set "PYTHON=.venv\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

set "RANKING_MIN_LEVEL=225"
set "RANKING_MAX_PAGES=800"
set "RANKING_REQUEST_DELAY_SEC=0.35"
set "NAVIGATOR_REQUEST_DELAY_SEC=0.35"
set "NAVIGATOR_FETCH_ENABLED=true"
set "SQLITE_DB_PATH=data/ranking.db"
set "MVP_JSON_OUTPUT_PATH=../web/public/data/rankings.json"

"%PYTHON%" enrich_rankings_navigator.py %*
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if %EXIT_CODE% equ 0 (
    echo [OK] See exp_ranking\web\public\data\rankings.json
    echo Refresh: ..\..\run_exp_ranking_web.bat
) else (
    echo [ERROR] exit code=%EXIT_CODE%
)

echo.
pause
exit /b %EXIT_CODE%
