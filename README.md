# myserver: Production-Ready Zero-Dependency API Server

A complete, self-contained, enterprise-grade backend server running entirely on **your own computer** built using **Node.js standard library built-in modules only** (`http`, `https`, `tls`, `crypto`, `fs`, `net`, `dgram`, `zlib`, `child_process`, `os`, `path`).

**Zero third-party npm packages. No external databases. No hosted services.**

---

## Architecture Overview

```
                      +---------------------------------------+
                      |       Public Internet / Client        |
                      +-------------------+-------------------+
                                          |
                        HTTPS (443) / DNS (53) / HTTP (80)
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| YOUR COMPUTER (Windows 11)                                                        |
|                                                                                   |
|  +--------------------+     +---------------------+     +-----------------------+ |
|  | Authoritative DNS  |     | HTTP -> HTTPS       |     | HTTPS API Engine      | |
|  | Server (UDP/TCP 53)|     | Redirect (Port 80)  |     | (Port 443 / 8443)     | |
|  +--------------------+     +---------------------+     +-----------+-----------+ |
|                                                                     |             |
|            +--------------------------------------------------------+             |
|            |                                                                      |
|  +---------v-----------+     +-------------------------------------------+        |
|  | Dashboard UI        |     | Zero-Dep Middleware Suite                 |        |
|  | (Control Panel &    |     | - Security Headers (HSTS, CSP, no-sniff)  |        |
|  |  Project Deployer)  |     | - CORS Allow-list Enforcement             |        |
|  +---------------------+     | - Sliding-Window Rate Limiter & Lockout   |        |
|                               | - Constant-Time API Key Verification      |        |
|                               | - JSON Stream Parser & Gzip Compression   |        |
|                               +-----------------------+-------------------+        |
|                                                       |                            |
|                                                       v                            |
|                               +-------------------------------------------+        |
|                               | REST Router & CRUD Endpoints              |        |
|                               | - GET /health (Public metrics)            |        |
|                               | - GET /docs (Interactive Web UI)          |        |
|                               | - /api/v1/notes (Full CRUD)               |        |
|                               | - /api/v1/projects (Deploy & Host)        |        |
|                               +-----------------------+-------------------+        |
|                                                       |                            |
|                                                       v                            |
|                               +-------------------------------------------+        |
|                               | Custom WAL Storage & Durability Engine    |        |
|                               | - Append-only Write-Ahead Log (JSONL)     |        |
|                               | - In-Memory Collection & Secondary Index  |        |
|                               | - Schema Validator & Advisory File Lock   |        |
|                               | - Atomic fsync & Periodic Snapshots       |        |
|                               | - Auto Daily Backups (7-day retention)    |        |
|                               +-------------------------------------------+        |
+-----------------------------------------------------------------------------------+
```

---

## Project Structure

```
myserver/
├── .env                  # Active environment variables (gitignored)
├── .env.example          # Environment configuration template
├── .gitignore            # Git rules preventing leaks of keys, logs & data
├── package.json          # Zero-dependency npm scripts manifest
├── README.md             # This file
├── CHECKLIST.md          # Verification and troubleshooting checklist
├── public/
│   └── dashboard/        # Web dashboard UI (Control Panel)
│       ├── index.html    # Dashboard page
│       ├── style.css     # Dashboard styling
│       └── app.js        # Dashboard client-side logic
│   └── projects/         # Deployed web projects live here
├── data/
│   ├── api_keys.json     # Stored SHA-256 hashed API keys
│   ├── zone.json         # Authoritative DNS records (A, CNAME, TXT, NS)
│   ├── snapshot.json     # Atomic snapshot of collection state
│   └── wal.jsonl         # Append-only Write-Ahead Log (fsync durable)
├── backups/              # Daily automatic backups and .sha256 checksums
├── logs/                 # Daily rotating access and error log files
├── certs/                # Root CA and Server TLS certificates
├── src/
│   ├── index.js          # Application bootstrapper and signal coordinator
│   ├── config.js         # Centralized configuration with typed fallbacks
│   ├── db/
│   │   ├── engine.js     # WAL coordinator, crash recovery, snapshots
│   │   ├── collection.js # In-memory collection, secondary indexes & queries
│   │   ├── wal.js        # Append-only WAL file with fsync durability
│   │   ├── schema.js     # Built-in data schema validator
│   │   ├── lock.js       # Advisory file locking with stale PID detection
│   │   └── backup.js     # Daily backup rotation and SHA-256 verification
│   ├── http/
│   │   ├── server.js     # Dual HTTP/HTTPS server with TLS hot-reload
│   │   ├── router.js     # Regex router with :params and query parser
│   │   ├── middleware.js  # Security headers, CORS, rate limiting, auth
│   │   ├── response.js   # JSON, error and HTML response helpers
│   │   ├── docs.js       # Dynamic Swagger-like interactive documentation
│   │   ├── compression.js # Gzip compression stream middleware
│   │   └── static.js     # Static file server with path traversal protection
│   ├── api/
│   │   ├── health.js     # Public health check endpoint
│   │   ├── notes.js      # Notes & Tasks REST CRUD endpoints
│   │   └── projects.js   # Project deployment & hosting manager
│   ├── security/
│   │   ├── auth.js       # Constant-time API key verification & rotation
│   │   ├── rate-limiter.js # Sliding-window rate limiter & brute-force lock
│   │   ├── jwt.js        # Pure HMAC-SHA256 JWT sign & verify
│   │   ├── env.js        # Built-in .env file parser (replaces dotenv)
│   │   └── logger.js     # Rotating file logger with secret masking
│   ├── certs/
│   │   ├── ca-gen.js     # Private Root CA & server cert generator
│   │   ├── cert-manager.js # TLS context manager & zero-downtime reloader
│   │   └── acme.js       # RFC 8555 ACME client for Let's Encrypt
│   ├── dns/
│   │   ├── server.js     # Dual UDP & TCP port 53 authoritative DNS server
│   │   ├── protocol.js   # RFC 1035 wire-protocol binary packet parser
│   │   └── ddns.js       # Dynamic DNS IP change detector & updater
│   ├── tunnel/
│   │   ├── relay-server.js # Reverse tunnel relay server (for VPS)
│   │   └── relay-client.js # Reverse tunnel client (for CGNAT traversal)
│   └── supervisor/
│       └── index.js      # Watchdog process with exponential backoff
├── cli/
│   ├── keys.js           # CLI: create, list, revoke, and rotate API keys
│   ├── backup.js         # CLI: snapshot, restore, and verify backups
│   └── certs.js          # CLI: generate CA, server certs, and trust guide
├── scripts/
│   ├── install-service.ps1  # Install Windows background Task Scheduler service
│   ├── install-service.bat  # One-click batch service installer
│   ├── firewall-setup.ps1   # Open ports 80, 443, 53 in Windows Firewall
│   └── hosts-setup.bat      # Configure myserver.local in Windows hosts file
└── tests/
    └── run-all.js        # Zero-dependency automated test runner
```

---

## Step-by-Step Setup Guide (From Zero to Live)

### Step 1: Verify Node.js

Ensure Node.js 18+ is installed on your computer:

```powershell
node -v
```

> No `npm install` is needed — zero external packages are used.

---

### Step 2: Run the Automated Test Suite

Verify that the database engine, WAL persistence, crash recovery, security modules, DNS protocol, and HTTP endpoints all pass:

```powershell
npm test
```

> All tests execute using Node's built-in `assert` module. All 22 tests should show `[PASS]`.

---

### Step 3: Configure Local Domain (`myserver.local`)

To allow your computer to resolve `myserver.local` directly:

1. Open PowerShell or Command Prompt as **Administrator**.
2. Run:

```cmd
scripts\hosts-setup.bat
```

Or manually add this line to `C:\Windows\System32\drivers\etc\hosts`:

```
127.0.0.1    myserver.local api.myserver.local
```

---

### Step 4: Generate Your Private Root CA and Server Certificates

Issue a 10-year private Root CA and an 825-day TLS server certificate with SAN for `myserver.local`, `localhost`, and your local IP:

```powershell
npm run certs:ca
npm run certs:server
```

#### Trust the Certificate on Windows 11 (Green Padlock in Browsers)

Open PowerShell as **Administrator**:

```powershell
Import-Certificate -FilePath "certs\ca.crt" -CertStoreLocation Cert:\LocalMachine\Root
```

Restart your browser. Your local domain now has a trusted HTTPS padlock!

For iPhone, Android, macOS, and Linux instructions:

```powershell
node cli/certs.js trust
```

---

### Step 5: Generate an API Key

```powershell
npm run keys create "My Admin Key"
```

Output example:

```text
=======================================================
API KEY GENERATED SUCCESSFULLY
=======================================================
Key ID   : 4f1a238b-90f1-4a12-8871-abcdef012345
Name     : My Admin Key
Raw Key  : sk_a8f9c0e2b4d6e8...

⚠️  SAVE THIS KEY NOW! The raw key will never be shown again.
Only its cryptographically secure SHA-256 hash is stored on disk.
=======================================================
```

---

### Step 6: Start the Server

#### Direct start:

```powershell
npm start
```

#### With watchdog supervisor (auto-restarts on crash):

```powershell
npm run supervisor
```

Console output:

```text
[INIT] Database ready. Active collections: notes, api_keys
[INIT] Daily automatic backup scheduled (Retention: 7 days)
[DNS] Authoritative DNS Server listening on UDP 0.0.0.0:5353
[HTTP] Port 80 active (Auto-redirecting to HTTPS)
[HTTPS] Secure API Server active on https://myserver.local:443
[DOCS] API Documentation: https://localhost:443/docs
```

> If you run without Administrator rights, the server automatically falls back to unprivileged ports: `8080` for HTTP, `8443` for HTTPS, and `5353` for DNS.

---

### Step 7: Open the Dashboard

Open your browser and navigate to:

**https://myserver.local/** (or **https://localhost:8443/** if using fallback ports)

You will see the interactive **Control Panel Dashboard** with:

- **Live system metrics** (status, uptime, memory, note count)
- **Deployed projects** grid with live links
- **Deploy New Project** button and form
- **Quick reference** commands for API keys, backups, certs, and services

---

### Step 8: View API Documentation

Navigate to:

**https://myserver.local/docs**

This shows the interactive dark-mode API explorer with schemas, response codes, and copyable `curl` commands.

---

### Step 9: Verify Endpoints with cURL

#### 1. Public Health Check

```bash
curl -k https://myserver.local/health
```

Expected: `200 OK` with `"status": "UP"`.

#### 2. Request Without API Key (Must Return 401)

```bash
curl -k https://myserver.local/api/v1/notes
```

Expected: `401 Unauthorized`.

#### 3. Create a Note with Valid API Key

```bash
curl -k -X POST https://myserver.local/api/v1/notes \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "First Production Note",
    "content": "Fully running on my own computer!",
    "status": "todo",
    "priority": "high",
    "tags": ["production", "self-hosted"]
  }'
```

Expected: `201 Created`.

#### 4. HTTPS Handshake Verification

```bash
curl -vk https://myserver.local/health 2>&1 | grep -i "subject\|issuer\|SSL"
```

---

## Deploying Your Own Web Projects

myserver doubles as a **static site hosting server**. You can deploy HTML/CSS/JS websites and apps to it and access them over HTTPS.

### Method 1: Deploy via the Dashboard UI

1. Open `https://myserver.local/` in your browser.
2. Click the **"+ Deploy New Project"** button.
3. Fill in:
   - **Project Name**: e.g., "My Portfolio"
   - **URL Slug**: e.g., "portfolio" (auto-generated from the name)
   - **HTML / CSS / JS**: Paste your code, or leave blank for a default template
   - **API Key**: Your `sk_...` key
4. Click **"🚀 Deploy Project"**.
5. Your project is immediately live at: **https://myserver.local/projects/portfolio/**

### Method 2: Deploy via cURL / API

Send a POST request to create a new project:

```bash
curl -k -X POST https://myserver.local/api/v1/projects/deploy \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Landing Page",
    "slug": "landing",
    "description": "Company landing page",
    "html": "<!DOCTYPE html><html><head><title>Hello</title><style>body{background:#0f172a;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif}</style></head><body><h1>Welcome to My Site!</h1></body></html>"
  }'
```

Your project is live at: **https://myserver.local/projects/landing/**

### Method 3: Deploy by Copying Files to Disk

Simply create a folder inside `./public/projects/` with your project files:

```
public/projects/my-app/
├── index.html
├── style.css
├── app.js
└── images/
    └── logo.png
```

Your project is immediately accessible at: **https://myserver.local/projects/my-app/**

No restart or reload needed — the static file server picks it up automatically.

### Managing Projects

```bash
# List all deployed projects
curl -k https://myserver.local/api/v1/projects

# Delete a project
curl -k -X DELETE https://myserver.local/api/v1/projects/my-app \
  -H "x-api-key: YOUR_API_KEY"
```

---

## Replicating This Server on Another Machine

Follow these steps to deploy an exact copy of this server on a different computer, a VPS, or a friend's machine.

### For Windows

```powershell
# 1. Copy the entire project folder to the new machine
#    (use USB drive, git clone, or zip and transfer)

# 2. Verify Node.js 18+ is installed
node -v

# 3. Navigate to the project
cd C:\path\to\myserver

# 4. Generate fresh secrets (IMPORTANT: do NOT reuse keys from another machine)
#    Edit .env and set a new random JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#    Copy the output into .env as JWT_SECRET=<output>

# 5. Delete old data, keys, and certificates (fresh start)
Remove-Item -Recurse -Force data\*.json, data\*.jsonl -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force certs\*.key, certs\*.crt, certs\*.pem, certs\*.srl -ErrorAction SilentlyContinue

# 6. Generate new TLS certificates for this machine
npm run certs:ca
npm run certs:server

# 7. Trust the new Root CA certificate
#    (Run as Administrator)
Import-Certificate -FilePath "certs\ca.crt" -CertStoreLocation Cert:\LocalMachine\Root

# 8. Configure local hostname
#    (Run as Administrator)
scripts\hosts-setup.bat

# 9. Generate a new API key
npm run keys create "Admin Key"
#    SAVE the sk_... key!

# 10. Run automated tests
npm test

# 11. Start the server
npm start

# 12. Open your browser to https://myserver.local/ (or https://localhost:8443/)

# 13. (Optional) Install as always-on background service
#     (Run as Administrator)
powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1

# 14. (Optional) Open firewall for LAN/internet access
#     (Run as Administrator)
powershell -ExecutionPolicy Bypass -File scripts\firewall-setup.ps1
```

### For Linux (Ubuntu/Debian)

```bash
# 1. Copy the project folder
scp -r myserver/ user@remote-server:/home/user/myserver
# OR: git clone <your-repo-url>

# 2. Verify Node.js 18+
node -v

# 3. Navigate to project
cd /home/user/myserver

# 4. Generate fresh secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Edit .env and replace JWT_SECRET with the output

# 5. Clean old state
rm -f data/*.json data/*.jsonl certs/*.key certs/*.crt certs/*.pem certs/*.srl

# 6. Generate certificates
npm run certs:ca
npm run certs:server

# 7. Trust the Root CA
sudo cp certs/ca.crt /usr/local/share/ca-certificates/myserver-ca.crt
sudo update-ca-certificates

# 8. Configure local hostname
echo "127.0.0.1 myserver.local api.myserver.local" | sudo tee -a /etc/hosts

# 9. Generate API key
npm run keys create "Admin Key"

# 10. Run tests
npm test

# 11. Start the server (use sudo for ports 80/443/53)
sudo node src/index.js

# 12. (Optional) Install as systemd service for always-on
sudo tee /etc/systemd/system/myserver.service << 'EOF'
[Unit]
Description=myserver Zero-Dependency API Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/home/user/myserver
ExecStart=/usr/bin/node src/supervisor/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable myserver
sudo systemctl start myserver

# Service management:
sudo systemctl status myserver    # Check status
sudo systemctl stop myserver      # Stop
sudo systemctl restart myserver   # Restart
journalctl -u myserver -f         # View live logs

# 13. (Optional) Open firewall
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 53/udp
sudo ufw allow 53/tcp
```

### For macOS

```bash
# 1. Copy project to Mac

# 2. Verify Node.js 18+
node -v

# 3. Navigate to project
cd ~/myserver

# 4-10. Same as Linux steps above (generate secrets, clean, certs, keys, test)

# 11. Start server (use sudo for privileged ports)
sudo node src/index.js

# 12. Trust Root CA
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain certs/ca.crt

# 13. (Optional) Create a launchd plist for always-on
sudo tee /Library/LaunchDaemons/com.myserver.api.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.myserver.api</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/you/myserver/src/supervisor/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/you/myserver</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/you/myserver/logs/stdout.log</string>
  <key>StandardErrorPath</key><string>/Users/you/myserver/logs/stderr.log</string>
</dict>
</plist>
EOF

sudo launchctl load /Library/LaunchDaemons/com.myserver.api.plist

# Service management:
sudo launchctl list | grep myserver       # Check status
sudo launchctl unload <plist-path>        # Stop
```

### Deploying to a Cloud VPS (DigitalOcean, Hetzner, AWS Lightsail, etc.)

```bash
# 1. Create a cheap VPS ($3-5/month) running Ubuntu 22.04+
# 2. SSH into it: ssh root@YOUR_VPS_IP
# 3. Install Node.js 18+:
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 4. Copy your project to the VPS:
scp -r myserver/ root@YOUR_VPS_IP:/opt/myserver

# 5. Follow the "For Linux" steps above (steps 3–13)
# 6. Point your domain's DNS A record to YOUR_VPS_IP
# 7. Your server is live at https://yourdomain.com!
```

### Using a Custom Domain Name

To make your server accessible via your own domain (e.g., `api.example.com`):

1. **Buy a domain** from any registrar (Namecheap, GoDaddy, Cloudflare, etc.)
2. **In your registrar's DNS settings**, add an **A Record**:
   - Host: `@` (or `api`)
   - Value: Your server's public IP address
   - TTL: Auto or 300
3. **Update your `.env` file**:
   ```
   DOMAIN=api.example.com
   ALLOWED_ORIGINS=https://api.example.com,https://example.com
   ```
4. **Regenerate certificates** for the new domain:
   ```bash
   npm run certs:server -- api.example.com
   ```
5. **For publicly-trusted certificates** (no browser warning for visitors), enable the built-in ACME client in `.env`:
   ```
   ACME_ENABLED=true
   ACME_EMAIL=admin@example.com
   ACME_DIRECTORY_URL=https://acme-v02.api.letsencrypt.org/directory
   ```
   > Note: This requires port 80 to be publicly accessible for the HTTP-01 challenge.

---

## Live Exposure to the Public Internet

### Option A: Direct Router Port-Forwarding (Standard Public / Dynamic IP)

If your ISP provides a public IP address:

1. **Find Your Computer's Local IP**:
   ```powershell
   ipconfig
   ```
   (e.g., `192.168.1.150`)

2. **Access Your Router Settings**: Open `http://192.168.1.1` in your browser.

3. **Set Port Forwarding Rules**:
   | External Port | Protocol | Internal IP       | Internal Port |
   | ------------- | -------- | ----------------- | ------------- |
   | 80            | TCP      | 192.168.1.150     | 80            |
   | 443           | TCP      | 192.168.1.150     | 443           |
   | 53            | UDP/TCP  | 192.168.1.150     | 53            |

4. **Open Windows Defender Firewall**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\firewall-setup.ps1
   ```

5. **Point your domain's DNS** to your public IP (found via `curl https://api.ipify.org`).

### Option B: Bypassing CGNAT (No Public IP)

If your ISP uses CGNAT:

1. **Deploy Relay on an inexpensive VPS ($3/mo)**:
   ```bash
   TUNNEL_SECRET="your-strong-secret" node src/tunnel/relay-server.js
   ```

2. **Run Tunnel Client on your home computer**:
   ```powershell
   $env:TUNNEL_RELAY_HOST="your-vps-ip"
   $env:TUNNEL_SECRET="your-strong-secret"
   npm run tunnel:client
   ```

---

## Always-On Background Service (Windows 11)

```powershell
# Install (Run as Administrator)
powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1

# Manage:
Start-ScheduledTask -TaskName "MyServer_Daemon"      # Start
Stop-ScheduledTask -TaskName "MyServer_Daemon"        # Stop
Get-ScheduledTask -TaskName "MyServer_Daemon"         # Status
Unregister-ScheduledTask -TaskName "MyServer_Daemon" -Confirm:$false  # Remove
```

---

## Database Backups and Maintenance

```powershell
npm run backup               # Create instant snapshot
npm run backup:verify         # Verify SHA-256 integrity
node cli/backup.js list       # List all backups
node cli/backup.js restore "backup-2026-10-22.json"  # Restore from backup
```

---

## License

MIT. Free to modify and self-host on your own infrastructure.
