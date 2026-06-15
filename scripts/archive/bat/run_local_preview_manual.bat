@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MapleN Board - Production Preview

echo [2/3] Installing dependencies if needed...
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm not found. Install Node.js first.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

if not exist "public\data\rankings.json" (
    echo [ERROR] public\data\rankings.json not found.
    echo Run from repo root: run_local_preview.bat
    pause
    exit /b 1
)

echo [3/3] Building for GitHub Pages and starting preview...
echo.
set "GITHUB_PAGES=true"
set "PAGES_BASE_PATH=/"
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo.
echo   Preview URL: http://localhost:4173/
echo   Press Ctrl+C to stop.
echo.
start "" "http://localhost:4173/"
call npm run preview -- --host 127.0.0.1 --port 4173
set "EXIT_CODE=%ERRORLEVEL%"

echo.
pause
exit /b %EXIT_CODE%
