@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Wrapper so bot/ scripts can point here; root run_local_dev.bat is preferred.
call "%~dp0..\..\run_local_dev.bat" %*
exit /b %ERRORLEVEL%
