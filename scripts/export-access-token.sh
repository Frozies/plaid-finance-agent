#!/usr/bin/env bash
# Export decrypted Plaid access token for use with external connectors.
# Usage: ./scripts/export-access-token.sh [institution_id]
#
# Requires: ENCRYPTION_KEY from .env, sqlite3, node/openssl
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="${PROJECT_DIR}/data/finance.db"
ENV_FILE="${PROJECT_DIR}/.env"

if [ ! -f "$DB_PATH" ]; then
  echo "Error: Database not found at $DB_PATH" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env not found at $ENV_FILE" >&2
  exit 1
fi

ENCRYPTION_KEY=$(grep '^ENCRYPTION_KEY=' "$ENV_FILE" | cut -d= -f2)
if [ -z "$ENCRYPTION_KEY" ]; then
  echo "Error: ENCRYPTION_KEY not found in .env" >&2
  exit 1
fi

INST_ID="${1:-}"

if [ -z "$INST_ID" ]; then
  echo "Available institutions:"
  sqlite3 "$DB_PATH" "SELECT id, institution_name, status FROM institutions;" | while IFS='|' read -r id name status; do
    echo "  $id  $name  ($status)"
  done
  echo ""
  echo "Usage: $0 <institution_id>"
  exit 0
fi

# Get encrypted token data
ROW=$(sqlite3 "$DB_PATH" "SELECT encrypted_access_token, iv, auth_tag FROM institutions WHERE id='${INST_ID}';")
if [ -z "$ROW" ]; then
  echo "Error: Institution $INST_ID not found" >&2
  exit 1
fi

ENCRYPTED=$(echo "$ROW" | cut -d'|' -f1)
IV=$(echo "$ROW" | cut -d'|' -f2)
AUTH_TAG=$(echo "$ROW" | cut -d'|' -f3)

# Decrypt using Node.js (matches the app's crypto.ts exactly)
ACCESS_TOKEN=$(node -e "
const crypto = require('crypto');
const key = Buffer.from('${ENCRYPTION_KEY}', 'hex');
const iv = Buffer.from('${IV}', 'hex');
const authTag = Buffer.from('${AUTH_TAG}', 'hex');
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(authTag);
let dec = decipher.update('${ENCRYPTED}', 'hex', 'utf8');
dec += decipher.final('utf8');
process.stdout.write(dec);
")

echo "$ACCESS_TOKEN"
