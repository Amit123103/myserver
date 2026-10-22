# myserver: Production Verification Checklist & Troubleshooting Guide

Use this checklist to verify every layer of your self-hosted API server, from local data durability to public internet exposure.

---

## 1. Pre-Flight Verification Checklist

| Status | Verification Item | Command / Test |
| :---: | :--- | :--- |
| [ ] | **Zero-Dependency Check** | Verify `node_modules` does not exist or isn't required. Run `npm test` without installing anything. |
| [ ] | **Automated Test Suite** | Run `npm test`. All 14 tests must report `[PASS]`. |
| [ ] | **Environment Configuration** | Check `.env` file exists and has a 32+ character random `JWT_SECRET`. |
| [ ] | **Advisory File Lock** | Ensure `data/db.lock` is acquired on startup and released on clean exit. |
| [ ] | **WAL Persistence** | Create a note, terminate the server, restart, and confirm the note is recovered from `data/wal.jsonl`. |
| [ ] | **Daily Backups** | Verify `backups/` contains a valid `.json` snapshot and matching `.sha256` checksum. |
| [ ] | **API Key Protection** | Ensure `curl -k https://myserver.local/api/v1/notes` returns `401 Unauthorized`. |
| [ ] | **Timing-Safe Comparison** | Confirm API keys are compared with `crypto.timingSafeEqual` and stored as SHA-256 hashes. |
| [ ] | **Security Headers** | Inspect headers with `curl -k -I https://myserver.local/health` (verify HSTS, CSP, X-Content-Type-Options). |
| [ ] | **Rate Limiter & Lockout** | Send rapid requests to verify `429 Too Many Requests` and brute-force IP lockout on repeated 401s. |
| [ ] | **DNS Protocol** | Query local DNS server: `nslookup myserver.local 127.0.0.1` (or test via `tests/run-all.js`). |
| [ ] | **Always-On Supervisor** | Kill the worker process; confirm supervisor logs restart with exponential backoff. |

---

## 2. Common Troubleshooting Scenarios

### Problem A: "Port 80 or Port 443 EACCES / Permission Denied"
* **Cause**: On Windows and UNIX systems, binding to ports below 1024 requires administrative privileges.
* **Solution**:
  1. **Option 1**: Right-click your terminal or PowerShell and choose **"Run as Administrator"**.
  2. **Option 2 (Automatic Fallback)**: If running as a standard user, `myserver` automatically binds to unprivileged fallback ports:
     - HTTP Redirect: `http://localhost:8080`
     - HTTPS API: `https://localhost:8443`
     - DNS Server: `5353`

---

### Problem B: "Browser says 'Your connection is not private' (NET::ERR_CERT_AUTHORITY_INVALID)"
* **Cause**: You are using your own private Root Certificate Authority, but your operating system or browser does not know to trust it yet.
* **Solution**:
  1. Install your Root CA certificate (`certs/ca.crt`) into the Windows Trusted Root Certification Authorities store:
     ```powershell
     # In PowerShell (Run as Administrator)
     Import-Certificate -FilePath "certs\ca.crt" -CertStoreLocation Cert:\LocalMachine\Root
     ```
  2. Completely close and reopen your browser (Chrome/Edge/Brave).
  3. Navigate to `https://myserver.local`. The padlock will now display as **Secure (green/locked)** with zero warnings.

---

### Problem C: "Could not resolve host: myserver.local"
* **Cause**: Your local operating system does not know how to map `myserver.local` to `127.0.0.1`.
* **Solution**:
  1. Run `scripts\hosts-setup.bat` as Administrator.
  2. Or edit `C:\Windows\System32\drivers\etc\hosts` with Notepad (Admin) and add:
     ```text
     127.0.0.1    myserver.local api.myserver.local
     ```
  3. Flush DNS resolver cache:
     ```cmd
     ipconfig /flushdns
     ```

---

### Problem D: "External visitors cannot reach my server (Port Forwarding Failure)"
* **Cause**: Router firewall, ISP blocking incoming ports 80/443, or Windows Firewall blocking the connection.
* **Solution**:
  1. **Check Windows Firewall**:
     Run in PowerShell (Admin):
     ```powershell
     powershell -ExecutionPolicy Bypass -File scripts\firewall-setup.ps1
     ```
  2. **Check Router Port-Forwarding**:
     Verify in your router's administration page (`192.168.1.1`) that ports `80` and `443` forward to your PC's local LAN IP (e.g., `192.168.1.150`).
  3. **Check for CGNAT (No Public IP)**:
     - Check your router's WAN IP address. If it starts with `100.64.x.x` through `100.127.x.x` or `10.x.x.x`, your ISP is placing you behind Carrier-Grade NAT.
     - **Fix**: Use the built-in reverse tunnel relay (`src/tunnel/relay-server.js` and `npm run tunnel:client`) to route traffic through an external relay server.

---

### Problem E: "Database says 'EEXIST: file already exists, open db.lock'"
* **Cause**: A previous server process terminated abruptly without releasing the advisory file lock.
* **Solution**:
  1. The database automatically checks if the locking process PID is still running.
  2. If the PID is dead, it cleans the stale lock automatically.
  3. To manually clear:
     ```powershell
     Remove-Item data\db.lock -Force -ErrorAction SilentlyContinue
     ```

---

### Problem F: "502 Bad Gateway / Connection Refused on Tunnel"
* **Cause**: Tunnel client is disconnected from the relay or target local HTTPS port is mismatched.
* **Solution**:
  1. Ensure your local server is actively running (`npm start`).
  2. Check `TUNNEL_LOCAL_TARGET_PORT` matches your HTTPS port (`443` or `8443`).
  3. Check tunnel secret matches between server and client.

---

## 3. Maintenance Runbook

### Log Rotation & Inspection
Access and error logs are stored in `./logs/` and rotated daily:
```powershell
# View recent access logs
Get-Content logs\access-*.log -Tail 20

# View recent errors
Get-Content logs\error-*.log -Tail 20
```

### Rotating Compromised API Keys
If a client key is leaked:
```powershell
# Find key ID
node cli/keys.js list

# Rotate key (invalidates old key immediately and generates replacement)
node cli/keys.js rotate <KEY_ID>
```

### Restoring Database from a Verified Backup
```powershell
# Verify backup integrity
node cli/backup.js verify backup-2026-10-22-20-20-00.json

# Restore state
node cli/backup.js restore backup-2026-10-22-20-20-00.json
```
