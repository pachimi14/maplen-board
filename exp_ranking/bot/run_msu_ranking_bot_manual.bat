@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MapleN Board Bot (Manual)

echo ========================================
echo  MapleN Board Bot - Manual Run
echo ========================================
echo.

if exist ".venv\Scripts\python.exe" (
    set "PYTHON=.venv\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

set "SKIP_RUN_IF_RANKING_DAY_EXISTS=true"
rem set "FORCE_RANKING_FETCH=true"

"%PYTHON%" main.py
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if %EXIT_CODE% equ 0 (
    echo [OK] Finished successfully.
) else (
    echo [ERROR] Failed. exit code=%EXIT_CODE%
    echo Check logs\msu_ranking_bot.log for details.
)

echo.
pause
exit /b %EXIT_CODE%
