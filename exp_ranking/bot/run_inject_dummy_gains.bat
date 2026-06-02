@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MSU Ranking - Inject Demo Gains

echo ========================================
echo  Inject dummy EXP gains (UI test)
echo  rankings.json -^> rankings.json.bak
echo.
echo  NOTE: This diverges from GitHub Pages / production data.
echo  To restore production JSON, run:
echo    run_sync_rankings_from_pages.bat
echo ========================================
echo.

if exist ".venv\Scripts\python.exe" (
    set "PYTHON=.venv\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

"%PYTHON%" inject_dummy_gains.py
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if %EXIT_CODE% equ 0 (
    echo [OK] Demo gains injected. Refresh the web UI.
    echo   JSON: ..\web\public\data\rankings.json
) else (
    echo [ERROR] exit code=%EXIT_CODE%
)

echo.
pause
exit /b %EXIT_CODE%
