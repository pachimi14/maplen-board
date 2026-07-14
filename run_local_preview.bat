@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MapleN Board - Local Preview

echo ========================================
echo  Local Preview  (production build)
echo ========================================
echo   URL: http://localhost:4173/
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
    echo [1/3] Sync rankings.json from production...
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
    echo [1/3] Skipping sync.
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
    echo [2/3] Installing npm packages...
    call npm install
    if %ERRORLEVEL% neq 0 (
        pause
        exit /b 1
    )
) else (
    echo [2/3] npm packages OK.
)

if not exist "%JSON%" (
    echo [ERROR] rankings.json not found.
    pause
    exit /b 1
)

echo [3/3] Building ^(GITHUB_PAGES=true^) and starting preview...
set "GITHUB_PAGES=true"
set "PAGES_BASE_PATH=/"
call npm run build
if %ERRORLEVEL% neq 0 (
    pause
    exit /b 1
)

echo.
start "" "http://localhost:4173/"
call npm run preview -- --host 127.0.0.1 --port 4173
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
