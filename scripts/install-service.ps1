# PowerShell Script to install myserver as a Windows background service using Task Scheduler
# Run this script in PowerShell as Administrator

$TaskName = "MyServer_Daemon"
$WorkingDir = (Get-Item $PSScriptRoot).Parent.FullName
$NodeExe = (Get-Command node).Source
$SupervisorScript = Join-Path $WorkingDir "src\supervisor\index.js"

Write-Host "Installing $TaskName as an always-on Windows background service..." -ForegroundColor Cyan
Write-Host "Working Directory : $WorkingDir"
Write-Host "Node Executable   : $NodeExe"

# Unregister existing task if present
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Action: launch node with supervisor script
$Action = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$SupervisorScript`"" -WorkingDirectory $WorkingDir

# Trigger: at system startup
$Trigger = New-ScheduledTaskTrigger -AtStartup

# Settings: restart on crash, run indefinitely, do not stop on battery
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1)

# Principal: SYSTEM or Administrator for highest privilege (ports 80/443/53 binding)
$Principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# Register task
Register-ScheduledTask -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Production Zero-Dependency API Server, DNS, and WAL Database"

Write-Host "`nTask '$TaskName' successfully registered with Windows Task Scheduler!" -ForegroundColor Green
Write-Host "Management Commands:" -ForegroundColor Yellow
Write-Host "  Start Service  : Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Stop Service   : Stop-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Check Status   : Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Uninstall Task : Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
