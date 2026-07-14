@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MapleN Board - Local Dev

echo ========================================
echo  Local Dev  (production JSON + hot reload)
echo ========================================
echo   URL: http://localhost:5173/#/
echo   Options: --no-sync
echo.

set "SKIP_SYNC=0"
if /I "%~1"=="--no-sync" set "SKIP_SYNC=1"

set "ROOT=%~dp0"
set "WEB=%ROOT%exp_ranking\web"
set "BOT=%ROOT%exp_ranking\bot"
set "JSON=%WEB%\public\data\v2\rankings.json"

if exist "%BOT%\.venv\Scripts\python.exe" (
    set "PYTHON=%BOT%\.venv\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

if "%SKIP_SYNC%"=="0" (
    echo [1/2] Sync rankings.json from production...
    "%PYTHON%" "%BOT%\sync_rankings_from_pages.py"
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Sync failed.
        pause
        exit /b 1
    )
    echo.
) else (
    if not exist "%JSON%" (
        echo [ERROR] --no-sync but rankings.json is missing.
        pause
        exit /b 1
    )
    echo [1/2] Skipping sync.
    echo.
)

where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm not found.
    pause
    exit /b 1
)

cd /d "%WEB%"
if not exist "node_modules\" (
    echo Installing npm packages...
    call npm install
    if %ERRORLEVEL% neq 0 (
        pause
        exit /b 1
    )
)

echo [2/2] Starting Vite dev server...
echo   Browser opens when ready. Press Ctrl+C to stop.
echo.
call npm run dev -- --host 127.0.0.1 --port 5173 --open "http://localhost:5173/#/"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
