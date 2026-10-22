# PowerShell Script to open required ports in Windows Firewall
# Run as Administrator

Write-Host "Configuring Windows Defender Firewall for myserver..." -ForegroundColor Cyan

# 1. Port 80 (HTTP Redirect)
New-NetFirewallRule -DisplayName "myserver HTTP (Port 80)" `
    -Direction Inbound `
    -LocalPort 80 `
    -Protocol TCP `
    -Action Allow `
    -Description "Allows incoming HTTP requests to be redirected to HTTPS"

# 2. Port 443 (HTTPS Secure API)
New-NetFirewallRule -DisplayName "myserver HTTPS (Port 443)" `
    -Direction Inbound `
    -LocalPort 443 `
    -Protocol TCP `
    -Action Allow `
    -Description "Allows secure incoming API traffic over TLS"

# 3. Port 53 (DNS UDP & TCP)
New-NetFirewallRule -DisplayName "myserver DNS UDP (Port 53)" `
    -Direction Inbound `
    -LocalPort 53 `
    -Protocol UDP `
    -Action Allow `
    -Description "Allows incoming DNS queries over UDP"

New-NetFirewallRule -DisplayName "myserver DNS TCP (Port 53)" `
    -Direction Inbound `
    -LocalPort 53 `
    -Protocol TCP `
    -Action Allow `
    -Description "Allows incoming DNS queries over TCP"

# 4. Fallback ports (8080, 8443, 5353)
New-NetFirewallRule -DisplayName "myserver Fallback Ports" `
    -Direction Inbound `
    -LocalPort 8080,8443,5353 `
    -Protocol TCP,UDP `
    -Action Allow `
    -Description "Allows development and unprivileged fallback ports"

Write-Host "Firewall rules created successfully!" -ForegroundColor Green
Write-Host "Ports 80 (TCP), 443 (TCP), 53 (UDP/TCP), 8080, 8443, 5353 are now open." -ForegroundColor Yellow
