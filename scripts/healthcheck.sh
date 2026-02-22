#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Plaid Finance Agent — Health Check Script
#
# Checks service health, database integrity, disk space, and backup freshness.
# Designed to run via cron every 5 minutes. Logs failures to syslog.
#
# Usage:
#   ./scripts/healthcheck.sh           # Run all checks
#   ./scripts/healthcheck.sh --verbose # Print all results, not just failures
#
# Cron setup (on the host):
#   */5 * * * * /home/finance/plaid-backend/scripts/healthcheck.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

VERBOSE="${1:-}"
FAILURES=0

log_ok() {
  if [ "$VERBOSE" = "--verbose" ]; then
    echo "[OK]   $1"
  fi
}

log_fail() {
  echo "[FAIL] $1" >&2
  logger -p user.err "plaid-finance HEALTHCHECK FAIL: $1" 2>/dev/null || true
  FAILURES=$((FAILURES + 1))
}

# ── 1. HTTP Health Endpoint ──────────────────────────────────────────────────

HTTP_CODE="$(curl -sf -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3100/health 2>/dev/null || echo "000")"
if [ "$HTTP_CODE" = "200" ]; then
  log_ok "HTTP health endpoint returned 200"
else
  log_fail "HTTP health endpoint returned ${HTTP_CODE} (expected 200)"
fi

# ── 2. Health Response Content ───────────────────────────────────────────────

if [ "$HTTP_CODE" = "200" ]; then
  HEALTH_STATUS="$(curl -sf --max-time 5 http://127.0.0.1:3100/health 2>/dev/null)"
  STATUS="$(echo "$HEALTH_STATUS" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || echo "")"
  if [ "$STATUS" = "healthy" ]; then
    log_ok "Health status: healthy"
  else
    log_fail "Health status: ${STATUS:-unknown} (expected healthy)"
  fi
fi

# ── 3. Database File Exists ──────────────────────────────────────────────────

DB_PATH="${PROJECT_DIR}/data/finance.db"
if [ -f "$DB_PATH" ]; then
  DB_SIZE="$(du -h "$DB_PATH" | cut -f1)"
  log_ok "Database exists (${DB_SIZE})"
else
  log_fail "Database file not found at ${DB_PATH}"
fi

# ── 4. Database Integrity (only if sqlite3 available) ────────────────────────

if command -v sqlite3 >/dev/null 2>&1 && [ -f "$DB_PATH" ]; then
  INTEGRITY="$(sqlite3 "$DB_PATH" "PRAGMA quick_check;" 2>/dev/null || echo "error")"
  if [ "$INTEGRITY" = "ok" ]; then
    log_ok "Database integrity: ok"
  else
    log_fail "Database integrity check failed: ${INTEGRITY}"
  fi
fi

# ── 5. Disk Space ────────────────────────────────────────────────────────────

DATA_DISK_USAGE="$(df "${PROJECT_DIR}/data" 2>/dev/null | awk 'NR==2 {print $5}' | tr -d '%')"
if [ -n "$DATA_DISK_USAGE" ]; then
  if [ "$DATA_DISK_USAGE" -lt 90 ]; then
    log_ok "Disk usage: ${DATA_DISK_USAGE}%"
  elif [ "$DATA_DISK_USAGE" -lt 95 ]; then
    log_fail "Disk usage WARNING: ${DATA_DISK_USAGE}% (>90%)"
  else
    log_fail "Disk usage CRITICAL: ${DATA_DISK_USAGE}% (>95%)"
  fi
fi

# ── 6. Backup Freshness ─────────────────────────────────────────────────────

BACKUP_DIR="${PROJECT_DIR}/backups"
if [ -d "$BACKUP_DIR" ] && ls "${BACKUP_DIR}"/finance-*.db >/dev/null 2>&1; then
  LATEST_BACKUP="$(ls -1t "${BACKUP_DIR}"/finance-*.db | head -1)"
  BACKUP_AGE_SECS="$(( $(date +%s) - $(stat -c %Y "$LATEST_BACKUP" 2>/dev/null || echo 0) ))"
  BACKUP_AGE_HOURS="$((BACKUP_AGE_SECS / 3600))"

  if [ "$BACKUP_AGE_HOURS" -lt 26 ]; then
    log_ok "Latest backup: $(basename "$LATEST_BACKUP") (${BACKUP_AGE_HOURS}h ago)"
  elif [ "$BACKUP_AGE_HOURS" -lt 50 ]; then
    log_fail "Backup stale: $(basename "$LATEST_BACKUP") is ${BACKUP_AGE_HOURS}h old (>26h)"
  else
    log_fail "Backup CRITICAL: $(basename "$LATEST_BACKUP") is ${BACKUP_AGE_HOURS}h old (>50h)"
  fi
else
  log_fail "No backups found in ${BACKUP_DIR}"
fi

# ── 7. Log File Size ────────────────────────────────────────────────────────

for logfile in "${PROJECT_DIR}/data/error.log" "${PROJECT_DIR}/data/combined.log"; do
  if [ -f "$logfile" ]; then
    LOG_SIZE_KB="$(du -k "$logfile" | cut -f1)"
    LOG_NAME="$(basename "$logfile")"
    if [ "$LOG_SIZE_KB" -lt 51200 ]; then  # 50MB
      log_ok "Log ${LOG_NAME}: ${LOG_SIZE_KB}KB"
    else
      log_fail "Log ${LOG_NAME} is large: ${LOG_SIZE_KB}KB (>50MB)"
    fi
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────

if [ "$FAILURES" -eq 0 ]; then
  if [ "$VERBOSE" = "--verbose" ]; then
    echo ""
    echo "All checks passed."
  fi
  exit 0
else
  echo ""
  echo "${FAILURES} check(s) failed."
  exit 1
fi
