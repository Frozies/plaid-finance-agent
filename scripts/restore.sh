#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Plaid Finance Agent — Database Restore Script
#
# Restores a SQLite backup to the live database location. The Plaid backend
# must be stopped before restoring to avoid corruption.
#
# Usage:
#   ./scripts/restore.sh                              # List available backups
#   ./scripts/restore.sh backups/finance-20260222.db  # Restore specific backup
#   ./scripts/restore.sh latest                       # Restore most recent backup
#
# Docker usage:
#   fin 'cd /home/finance/plaid-backend && docker compose stop plaid-finance'
#   ./scripts/restore.sh latest
#   fin 'cd /home/finance/plaid-backend && docker compose start plaid-finance'
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

DB_PATH="${PROJECT_DIR}/data/finance.db"
BACKUP_DIR="${PROJECT_DIR}/backups"

# ── No arguments: list available backups ─────────────────────────────────────

if [ $# -eq 0 ]; then
  echo "Available backups:"
  echo ""
  if [ -d "$BACKUP_DIR" ] && ls "${BACKUP_DIR}"/finance-*.db >/dev/null 2>&1; then
    ls -lhtr "${BACKUP_DIR}"/finance-*.db | awk '{print "  " $NF " (" $5 ", " $6 " " $7 " " $8 ")"}'
    echo ""
    LATEST="$(ls -1t "${BACKUP_DIR}"/finance-*.db | head -1)"
    echo "Latest: $(basename "$LATEST")"
    echo ""
    echo "Usage: $0 <backup-file>    # Restore a specific backup"
    echo "       $0 latest           # Restore the most recent backup"
  else
    echo "  No backups found in ${BACKUP_DIR}"
    echo ""
    echo "Run ./scripts/backup.sh first to create a backup."
  fi
  exit 0
fi

# ── Resolve backup file ─────────────────────────────────────────────────────

BACKUP_FILE="$1"

if [ "$BACKUP_FILE" = "latest" ]; then
  if ! ls "${BACKUP_DIR}"/finance-*.db >/dev/null 2>&1; then
    echo "ERROR: No backups found in ${BACKUP_DIR}" >&2
    exit 1
  fi
  BACKUP_FILE="$(ls -1t "${BACKUP_DIR}"/finance-*.db | head -1)"
  echo "Using latest backup: $(basename "$BACKUP_FILE")"
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

# ── Verify backup integrity before restoring ─────────────────────────────────

echo "Verifying backup integrity..."
INTEGRITY="$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" 2>/dev/null)"
if [ "$INTEGRITY" != "ok" ]; then
  echo "ERROR: Backup failed integrity check!" >&2
  echo "Result: ${INTEGRITY}" >&2
  exit 1
fi

BACKUP_TXNS="$(sqlite3 "$BACKUP_FILE" "SELECT COUNT(*) FROM transactions;" 2>/dev/null || echo "?")"
BACKUP_INSTS="$(sqlite3 "$BACKUP_FILE" "SELECT COUNT(*) FROM institutions;" 2>/dev/null || echo "?")"
echo "Backup contents: ${BACKUP_INSTS} institution(s), ${BACKUP_TXNS} transaction(s)"

# ── Safety check: is the backend running? ────────────────────────────────────

if curl -sf http://127.0.0.1:3100/health >/dev/null 2>&1; then
  echo ""
  echo "WARNING: The Plaid backend appears to be running on port 3100."
  echo "Restoring while the server is running can cause database corruption."
  echo ""
  echo "Stop it first:"
  echo "  docker compose stop plaid-finance"
  echo "  # or: kill the Node process"
  echo ""
  read -r -p "Continue anyway? (y/N) " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# ── Create safety backup of current DB ───────────────────────────────────────

if [ -f "$DB_PATH" ]; then
  SAFETY_BACKUP="${DB_PATH}.pre-restore.$(date '+%Y%m%d_%H%M%S')"
  echo "Saving current database to: $(basename "$SAFETY_BACKUP")"
  cp "$DB_PATH" "$SAFETY_BACKUP"

  # Also copy WAL and SHM files if they exist
  [ -f "${DB_PATH}-wal" ] && cp "${DB_PATH}-wal" "${SAFETY_BACKUP}-wal"
  [ -f "${DB_PATH}-shm" ] && cp "${DB_PATH}-shm" "${SAFETY_BACKUP}-shm"
fi

# ── Restore ──────────────────────────────────────────────────────────────────

echo "Restoring from: $(basename "$BACKUP_FILE")"

# Remove WAL/SHM files from the live DB (they belong to the old state)
rm -f "${DB_PATH}-wal" "${DB_PATH}-shm"

# Copy the backup to the live location
cp "$BACKUP_FILE" "$DB_PATH"

# Verify the restored database
INTEGRITY="$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;" 2>/dev/null)"
if [ "$INTEGRITY" = "ok" ]; then
  RESTORED_TXNS="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM transactions;" 2>/dev/null || echo "?")"
  echo ""
  echo "Restore complete. Database integrity: OK (${RESTORED_TXNS} transactions)"
  echo ""
  echo "Next steps:"
  echo "  1. Start the Plaid backend: docker compose start plaid-finance"
  echo "  2. Verify: curl http://127.0.0.1:3100/health"
  echo "  3. Trigger a sync to catch up: curl -X POST -H 'Authorization: Bearer ...' http://127.0.0.1:3100/api/transactions/sync"
else
  echo "ERROR: Restored database failed integrity check!" >&2
  echo "The pre-restore backup is at: ${SAFETY_BACKUP}" >&2
  echo "To revert: cp '${SAFETY_BACKUP}' '${DB_PATH}'" >&2
  exit 1
fi
