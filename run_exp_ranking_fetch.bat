@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MapleN Board - Data Fetch

echo ========================================
echo  MapleN Board - Data Fetch
echo ========================================
echo.

call "%~dp0exp_ranking\bot\run_fetch_ranking_manual.bat"
exit /b %ERRORLEVEL%
