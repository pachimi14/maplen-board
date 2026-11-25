@echo off
rem Called by Windows Task Scheduler (see README.md in this folder).
cd /d "%~dp0.."
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" ops\sf_daily_fetch.py %*
) else (
    python ops\sf_daily_fetch.py %*
)
exit /b %ERRORLEVEL%
