import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import logger from '../services/logger';

const DB_PATH = path.join(__dirname, '../../data/finance.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  const tableCheck = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='institutions'"
  ).get() as { name: string } | undefined;

  if (!tableCheck) {
    logger.info('Initializing database schema...');
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schema);
    logger.info('Database schema initialized');
  }

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

process.on('SIGINT', closeDb);
process.on('SIGTERM', closeDb);
