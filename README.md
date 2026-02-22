# Plaid Finance Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Self-hosted personal & business finance backend for [OpenClaw](https://github.com/Frozies/openclaw). Links bank accounts via Plaid, tracks spending, budgets, investments, and liabilities — all queryable conversationally through Telegram.

## Architecture

```
OpenClaw (Telegram) → SKILL.md → Plaid Finance Backend → Plaid API → Your Banks
                                       ↓
                                  SQLite (encrypted)
                                       ↓
                                  Cron Scheduler → Alerts → Telegram
```

**Stack:** TypeScript · Node.js · Express · SQLite (WAL mode) · Docker · Plaid API

## Getting Started

### Prerequisites

- Docker & Docker Compose
- [Plaid API credentials](https://dashboard.plaid.com/developers/keys) (Sandbox for testing, Production for real accounts)

### Build from GitHub

```bash
# 1. Clone the repo
git clone https://github.com/Frozies/plaid-finance-agent.git
cd plaid-finance-agent

# 2. Generate security keys
npm install
npm run generate-keys
# Copy the ENCRYPTION_KEY and BEARER_TOKEN output

# 3. Configure environment
cp .env.example .env
# Edit .env with your Plaid API keys and generated keys

# 4. Build and run
docker compose up -d

# 5. Verify
curl http://localhost:3100/health
```

### Transfer to Server (SCP)

If you prefer to deploy from a tarball instead of cloning on the server:

```bash
# On your dev machine — build the tarball (excludes node_modules, dist, data, secrets)
tar czf plaid-finance-agent.tar.gz \
  --exclude=node_modules --exclude=dist --exclude=data \
  --exclude=backups --exclude=.env --exclude='*.log' \
  --exclude=.idea \
  -C "$(dirname /path/to/plaid-finance-agent)" plaid-finance-agent

# Transfer to server
scp plaid-finance-agent.tar.gz claw:/tmp/

# On the server — extract and deploy
sudo -u finance bash -c 'tar xzf /tmp/plaid-finance-agent.tar.gz -C /home/finance/plaid-backend --strip-components=1'
rm /tmp/plaid-finance-agent.tar.gz

# Configure and start (same as steps 2–5 above)
```

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health check |
| POST | `/api/link/token` | Generate Plaid Link token |
| POST | `/api/link/exchange` | Exchange public token after linking |
| GET | `/api/accounts` | List all accounts |
| GET | `/api/balances` | Get current balances + net worth |
| GET | `/api/institutions` | List linked institutions |
| DELETE | `/api/institutions/:id` | Unlink an institution |
| GET | `/api/transactions` | Query transactions (filterable) |
| GET | `/api/transactions/summary` | Spending summary by category |
| POST | `/api/transactions/:id/tag` | Tag transaction (business/category) |
| POST | `/api/transactions/sync` | Trigger manual sync |
| GET | `/api/investments` | Portfolio holdings |
| GET | `/api/investments/performance` | Portfolio performance over time |
| GET | `/api/liabilities` | Credit cards, loans, mortgages |
| GET | `/api/budgets` | Budget status |
| POST | `/api/budgets` | Create budget |
| PUT | `/api/budgets/:id` | Update budget |
| DELETE | `/api/budgets/:id` | Delete budget |
| GET | `/api/categories/overrides` | List auto-tag rules |
| POST | `/api/categories/overrides` | Create auto-tag rule |
| POST | `/api/webhooks` | Plaid webhook receiver |

All endpoints (except `/health` and `/api/webhooks`) require `Authorization: Bearer <token>` header.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PLAID_CLIENT_ID` | Yes | — | Plaid API client ID |
| `PLAID_SECRET` | Yes | — | Plaid API secret |
| `PLAID_ENV` | Yes | `sandbox` | Plaid environment (`sandbox`, `development`, `production`) |
| `ENCRYPTION_KEY` | Yes | — | AES-256 key for encrypting Plaid access tokens at rest |
| `BEARER_TOKEN` | Yes | — | Bearer token for API authentication |
| `PORT` | No | `3100` | Server port |
| `HOST` | No | `127.0.0.1` | Bind address |
| `LOG_LEVEL` | No | `info` | Winston log level (`error`, `warn`, `info`, `debug`) |
| `WEBHOOK_URL` | No | — | Public URL for Plaid webhooks (leave blank for poll-only) |
| `OPENCLAW_WEBHOOK_URL` | No | — | OpenClaw notification endpoint for alerts |

Generate `ENCRYPTION_KEY` and `BEARER_TOKEN` with:

```bash
npm run generate-keys
```

## Scheduled Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| Transaction sync | Every 4 hours | Pull new transactions via cursor |
| Balance sync | Every 4 hours (+30 min offset) | Refresh account balances |
| Daily snapshot | 6 AM | Store balance/portfolio snapshots |
| Alert check | 8 PM | Evaluate budget & balance alerts |
| Stale account check | 9 AM | Flag institutions needing re-auth |
| Weekly summary | Sunday 7 PM | Full spending breakdown |

## Security

- Access tokens encrypted with AES-256-GCM at rest
- Bearer token auth on all API routes
- Listens on `127.0.0.1` only (use Tailscale for remote access)
- Plaid tokens are read-only (cannot initiate transfers)
- SQLite database inside Docker volume
- All secrets excluded from version control via `.gitignore`

## OpenClaw Integration

Copy `skill/SKILL.md` to your OpenClaw skills directory. Configure the skill environment:

```bash
FINANCE_API_URL=http://localhost:3100
FINANCE_API_TOKEN=your_bearer_token
```

Then restart the OpenClaw gateway. You can now ask things like:
- "What's my checking account balance?"
- "Show my spending this month"
- "How much did I spend on food last week?"

## Backup & Recovery

The Docker Compose stack includes a `plaid-backup` sidecar that runs daily at 2:00 AM:

1. Checkpoints the SQLite WAL (`PRAGMA wal_checkpoint(TRUNCATE)`)
2. Creates a timestamped copy via SQLite's `.backup` API (safe for concurrent access)
3. Verifies integrity with `PRAGMA integrity_check`
4. Rotates old backups (keeps 14 days)

**Manual backup:**

```bash
./scripts/backup.sh
```

**Restore from backup:**

```bash
# List available backups
./scripts/restore.sh

# Restore the latest
docker compose stop plaid-finance
./scripts/restore.sh latest
docker compose start plaid-finance
```

**Health check:**

```bash
./scripts/healthcheck.sh --verbose
```

## License

[MIT](LICENSE) — Davin Young
