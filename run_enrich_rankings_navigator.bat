@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MapleN Board - Enrich Navigator (local)

echo ========================================
echo  Enrich rankings.json with server data
echo  (ranking API keys + Navigator worldId)
echo ========================================
echo.
echo  This may take a long time (~5500 Navigator calls).
echo  Progress is saved in exp_ranking\bot\data\ranking.db
echo  Re-run this script to continue after rate limits.
echo.

call "%~dp0exp_ranking\bot\run_enrich_rankings_navigator.bat"
exit /b %ERRORLEVEL%
