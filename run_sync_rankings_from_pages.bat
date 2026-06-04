@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MapleN Board - Sync from GitHub Pages

call "%~dp0exp_ranking\bot\run_sync_rankings_from_pages.bat"
exit /b %ERRORLEVEL%
