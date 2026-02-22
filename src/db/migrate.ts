import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/**
 * Database Migration Runner
 *
 * Applies incremental schema migrations using the schema_version table.
 * Each migration is a function keyed by its version number.
 *
 * Usage:
 *   npm run migrate          # Apply pending migrations
 *   npm run migrate -- --status  # Show current version & pending count
 */

const DB_PATH = path.join(__dirname, '../../data/finance.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// ── Migration Definitions ────────────────────────────────────────────────────
// Add new migrations here. Each key is the version number, each value is
// a function that receives the db instance and applies the migration.

const migrations: Record<number, { description: string; up: (db: Database.Database) => void }> = {
  1: {
    description: 'Initial schema (applied via schema.sql)',
    up: (_db) => {
      // Version 1 is the initial schema — applied by connection.ts on first run.
      // This entry exists so the migration runner recognises it.
    },
  },
  // ── Add future migrations below ──
  // 2: {
  //   description: 'Add recurring_transactions table',
  //   up: (db) => {
  //     db.exec(`
  //       CREATE TABLE IF NOT EXISTS recurring_transactions (
  //         id INTEGER PRIMARY KEY AUTOINCREMENT,
  //         pattern TEXT NOT NULL,
  //         category TEXT,
  //         frequency TEXT DEFAULT 'monthly',
  //         detected_at DATETIME DEFAULT CURRENT_TIMESTAMP
  //       );
  //     `);
  //   },
  // },
};

// ── Runner ───────────────────────────────────────────────────────────────────

function ensureDatabase(): Database.Database {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Ensure base schema exists (tables + schema_version)
  const hasSchema = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();

  if (!hasSchema) {
    console.log('No schema found — applying initial schema.sql ...');
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schema);
    console.log('Initial schema applied (version 1).');
  }

  return db;
}

function getCurrentVersion(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as
    | { version: number | null }
    | undefined;
  return row?.version ?? 0;
}

function getLatestVersion(): number {
  const versions = Object.keys(migrations).map(Number);
  return versions.length > 0 ? Math.max(...versions) : 0;
}

function showStatus(db: Database.Database): void {
  const current = getCurrentVersion(db);
  const latest = getLatestVersion();
  const pending = latest - current;

  console.log(`Current schema version : ${current}`);
  console.log(`Latest available       : ${latest}`);
  console.log(`Pending migrations     : ${pending}`);

  if (pending > 0) {
    console.log('\nPending:');
    for (let v = current + 1; v <= latest; v++) {
      const m = migrations[v];
      console.log(`  v${v}: ${m?.description ?? '(no description)'}`);
    }
  }
}

function runMigrations(db: Database.Database): void {
  const current = getCurrentVersion(db);
  const latest = getLatestVersion();

  if (current >= latest) {
    console.log(`Database is up to date (version ${current}).`);
    return;
  }

  console.log(`Migrating from version ${current} to ${latest} ...`);

  for (let v = current + 1; v <= latest; v++) {
    const migration = migrations[v];
    if (!migration) {
      console.error(`ERROR: Migration v${v} is missing! Aborting.`);
      process.exit(1);
    }

    console.log(`  Applying v${v}: ${migration.description} ...`);

    const applyMigration = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v);
    });

    try {
      applyMigration();
      console.log(`  v${v} applied.`);
    } catch (err) {
      console.error(`  FAILED at v${v}: ${(err as Error).message}`);
      console.error('  Migration rolled back. Fix the issue and re-run.');
      process.exit(1);
    }
  }

  console.log(`\nMigration complete. Now at version ${latest}.`);
}

// ── CLI Entry ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const db = ensureDatabase();

try {
  if (args.includes('--status')) {
    showStatus(db);
  } else {
    runMigrations(db);
  }
} finally {
  db.close();
}
