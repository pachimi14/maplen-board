@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MapleN Board - Export MVP JSON Only

echo ========================================
echo  Export MVP JSON from SQLite
echo ========================================
echo.

if exist ".venv\Scripts\python.exe" (
    set "PYTHON=.venv\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

"%PYTHON%" export_mvp_json.py
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if %EXIT_CODE% equ 0 (
    echo [OK] rankings.json exported.
) else (
    echo [ERROR] Failed. exit code=%EXIT_CODE%
)

echo.
pause
exit /b %EXIT_CODE%
