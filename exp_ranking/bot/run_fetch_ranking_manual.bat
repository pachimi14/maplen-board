@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MSU Ranking - Data Fetch

echo ========================================
echo  MSU Ranking - Data Fetch
echo  (API -^> SQLite + rankings.json)
echo ========================================
echo.

if exist ".venv\Scripts\python.exe" (
    set "PYTHON=.venv\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

rem Same defaults as .github/workflows/exp-ranking-pages.yml
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

"%PYTHON%" main.py
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if %EXIT_CODE% equ 0 (
    echo [OK] Data fetch completed.
    echo   DB:     data\ranking.db
    echo   JSON:   ..\web\public\data\rankings.json
    echo.
    echo To open the site, run:
    echo   ..\..\run_exp_ranking_web.bat
) else (
    echo [ERROR] Failed. exit code=%EXIT_CODE%
    echo Check logs\msu_ranking_bot.log for details.
)

echo.
pause
exit /b %EXIT_CODE%
