#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Plaid Finance Agent — Manual/Cron Backup Script
#
# Creates a safe SQLite backup using the .backup command (online backup API),
# verifies integrity, and rotates old backups.
#
# Usage:
#   ./scripts/backup.sh                     # Backup to ./backups/
#   ./scripts/backup.sh /path/to/dest       # Backup to custom directory
#   RETENTION=30 ./scripts/backup.sh        # Keep 30 days instead of 14
#
# For Docker deployments, the plaid-backup sidecar container runs this logic
# automatically. This script is for manual backups or host-level cron.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

DB_PATH="${PROJECT_DIR}/data/finance.db"
BACKUP_DIR="${1:-${PROJECT_DIR}/backups}"
RETENTION="${RETENTION:-14}"
STAMP="$(date '+%Y%m%d_%H%M%S')"
BACKUP_FILE="${BACKUP_DIR}/finance-${STAMP}.db"

# ── Preflight ────────────────────────────────────────────────────────────────

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "ERROR: sqlite3 is not installed. Install it with: apt install sqlite3" >&2
  exit 1
fi

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: Database not found at ${DB_PATH}" >&2
  echo "Is the Plaid backend running? The database is created on first start." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# ── Checkpoint WAL ───────────────────────────────────────────────────────────
# SQLite WAL (Write-Ahead Logging) keeps recent writes in a separate -wal file.
# Checkpointing flushes all WAL data into the main .db file so the backup
# captures everything. TRUNCATE mode also resets the WAL file to zero size.

echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') Checkpointing WAL..."
sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true

# ── Create Backup ────────────────────────────────────────────────────────────
# Using SQLite's .backup command, which is safe for concurrent access.
# It uses the online backup API internally and handles locking correctly,
# even if the Plaid backend is actively writing transactions.

echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') Creating backup: $(basename "$BACKUP_FILE")"
sqlite3 "$DB_PATH" ".backup '${BACKUP_FILE}'"

# ── Verify Integrity ────────────────────────────────────────────────────────

INTEGRITY="$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" 2>/dev/null)"
if [ "$INTEGRITY" = "ok" ]; then
  SIZE="$(du -h "$BACKUP_FILE" | cut -f1)"
  ROWS="$(sqlite3 "$BACKUP_FILE" "SELECT COUNT(*) FROM transactions;" 2>/dev/null || echo "?")"
  echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') Backup verified OK (${SIZE}, ${ROWS} transactions)"
else
  echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') WARNING: Integrity check failed!" >&2
  echo "[backup] Result: ${INTEGRITY}" >&2
  exit 1
fi

# ── Rotate Old Backups ───────────────────────────────────────────────────────

REMOVED=0
while IFS= read -r old_backup; do
  rm -f "$old_backup"
  REMOVED=$((REMOVED + 1))
done < <(ls -1t "${BACKUP_DIR}"/finance-*.db 2>/dev/null | tail -n +"$((RETENTION + 1))")

if [ "$REMOVED" -gt 0 ]; then
  echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') Rotated ${REMOVED} old backup(s) (keeping ${RETENTION})"
fi

TOTAL="$(ls -1 "${BACKUP_DIR}"/finance-*.db 2>/dev/null | wc -l)"
echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') Done. ${TOTAL} backup(s) in ${BACKUP_DIR}"
