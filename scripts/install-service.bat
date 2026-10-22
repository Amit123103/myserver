@echo off
setlocal
echo ====================================================================
echo Installing myserver as a Windows Always-On Background Service
echo ====================================================================

set SCRIPT_DIR=%~dp0..
cd /d "%SCRIPT_DIR%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-service.ps1"

pause
