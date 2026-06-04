@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title MapleN Board Bot

if exist ".venv\Scripts\python.exe" (
    set "PYTHON=.venv\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

"%PYTHON%" main.py
set "EXIT_CODE=%ERRORLEVEL%"

if %EXIT_CODE% neq 0 (
    echo [ERROR] MapleN Board bot failed. exit code=%EXIT_CODE%
)

exit /b %EXIT_CODE%
