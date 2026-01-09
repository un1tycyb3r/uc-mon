# UC-Mon 🔍

**JavaScript File Monitor** - Track changes in JS files across scans for bug bounty recon.

## Features

- **🕷️ Dynamic JS Extraction** - Uses Puppeteer to capture all JavaScript files, including dynamically loaded scripts
- **🔄 Smart Filename Normalization** - Handles hashed/chunked filenames (e.g., `main.abc123.js`) to track the same file across builds
- **📊 Version Tracking** - Stores every version of each JS file for historical comparison
- **🔍 Diff Comparison** - Compare any two versions to see exactly what changed

## Installation

```bash
cd uc-mon
npm install
```

### Ubuntu Server Setup

For headless servers (droplets, VPS, etc.), install Chromium dependencies:

```bash
# Install Chromium and dependencies
sudo apt-get update
sudo apt-get install -y chromium-browser

# Or install just the dependencies for Puppeteer's bundled Chrome
sudo apt-get install -y \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  lsb-release \
  wget \
  xdg-utils
```

**Alternative: Use fetch mode** (no browser needed, but won't catch dynamically loaded scripts):

```bash
node src/cli.js scan target.com --mode fetch
```

## Commands

### `scan` - One-time scan

```bash
# Basic scan (uses Puppeteer/Chrome)
node src/cli.js scan https://acrobat.adobe.com

# Lightweight mode (no browser, works on any server)
node src/cli.js scan target.com --mode fetch

# Custom Chrome path (for servers with Chrome installed elsewhere)
node src/cli.js scan target.com --chrome /usr/bin/chromium-browser

# With options
node src/cli.js scan target.com --timeout 60000 --wait 10000

# JSON output
node src/cli.js scan target.com --json > results.json

# Disable Discord notifications
node src/cli.js scan target.com --no-notify
```

### `monitor` - Continuous monitoring

```bash
# Check every hour (default)
node src/cli.js monitor https://target.com

# Check every 30 minutes
node src/cli.js monitor https://target.com --interval 30

# Use fetch mode on servers
node src/cli.js monitor target.com --mode fetch --interval 60
```

### `targets` - List scanned targets

```bash
node src/cli.js targets
```

### `history` - View scan history

```bash
node src/cli.js history acrobat.adobe.com
```

### `scripts` - List scripts for a target

```bash
node src/cli.js scripts acrobat.adobe.com
```

### `diff` - Compare script versions

```bash
# Diff the two most recent versions
node src/cli.js diff <scriptId>

# Diff specific versions
node src/cli.js diff 42 --v1 10 --v2 15

# Show more lines
node src/cli.js diff 42 --lines 100
```

## Output Example

```
┌─────────── Scan Results ───────────┐
│                                    │
│   Target: acrobat.adobe.com        │
│   URL: https://acrobat.adobe.com   │
│   Time: 2024-01-15T10:30:00.000Z   │
│                                    │
│   Scripts: 45                      │
│   Total Size: 2.3 MB               │
│                                    │
└────────────────────────────────────┘

🆕 3 New Script(s):

  + vendor.js (245.3 KB)
  + analytics.js (12.1 KB)
  + checkout.js (34.5 KB)

📝 2 Updated Script(s):

  ~ main.js +127 -34
  ~ app.js +45 -12

42 script(s) unchanged
```

## Data Storage

All data is stored in `data/`:
- `uc-mon.json` - Metadata (targets, scans, script info)
- `scripts/` - Actual JS file versions

## Cron Example

```bash
# Scan every 6 hours
0 */6 * * * cd /path/to/uc-mon && node src/cli.js scan https://target.com --json >> /var/log/uc-mon/target.log
```

## TODO

- [ ] **UI** - Web interface for browsing targets, scripts, and diffs
- [ ] **Auth Module** - Handle files behind authentication (cookies, headers, login flows)
- [ ] **Improved Script Storing** - Better deduplication, compression, and cleanup of old versions
- [ ] **Background Monitor Process** - Daemonize the monitor command to run persistently in the background

## License

MIT
