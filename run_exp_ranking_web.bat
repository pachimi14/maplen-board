@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MapleN Board - Web

echo ========================================
echo  MapleN Board - Web
echo ========================================
echo.

start "MapleN Board Web" cmd /k "%~dp0exp_ranking\web\run_web_dev_manual.bat"
exit /b 0
