@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MapleN Board - Sync JSON from GitHub Pages

echo ========================================
echo  Sync rankings.json from GitHub Pages
echo  (same data as the public site)
echo ========================================
echo.

if exist ".venv\Scripts\python.exe" (
    set "PYTHON=.venv\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

"%PYTHON%" sync_rankings_from_pages.py
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if %EXIT_CODE% equ 0 (
    echo Refresh the dev UI: ..\..\run_exp_ranking_web.bat
) else (
    echo [ERROR] Sync failed. exit code=%EXIT_CODE%
)

echo.
pause
exit /b %EXIT_CODE%
