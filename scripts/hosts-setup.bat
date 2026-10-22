@echo off
setlocal
echo Configuring local hosts file for myserver.local...

set HOSTS_FILE=%SystemRoot%\System32\drivers\etc\hosts
findstr /i "myserver.local" "%HOSTS_FILE%" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] myserver.local is already configured in %HOSTS_FILE%
) else (
    echo 127.0.0.1    myserver.local api.myserver.local>>"%HOSTS_FILE%"
    if %ERRORLEVEL% equ 0 (
        echo [OK] Successfully added myserver.local to %HOSTS_FILE%
    ) else (
        echo [ERROR] Failed to modify hosts file. Please right-click and "Run as Administrator".
    )
)

pause
