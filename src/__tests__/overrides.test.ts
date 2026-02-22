import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from './helpers/testdb';

let testDb: Database.Database;

vi.mock('../db/connection', () => ({
  getDb: () => testDb,
  closeDb: () => testDb?.close(),
}));

import { applyOverrides } from '../services/sync';

describe('applyOverrides', () => {
  beforeEach(() => {
    testDb = createTestDb();
    seedTestData(testDb);
  });

  afterEach(() => {
    testDb?.close();
  });

  it('returns null category for null merchant name', () => {
    const result = applyOverrides(null);
    expect(result.category).toBeNull();
    expect(result.isBusiness).toBe(false);
  });

  it('matches "contains" override (case-insensitive)', () => {
    const result = applyOverrides('STARBUCKS Reserve');
    expect(result.category).toBe('Coffee');
    expect(result.isBusiness).toBe(false);
  });

  it('matches "exact" override', () => {
    const result = applyOverrides('Staples');
    expect(result.category).toBe('Office');
    expect(result.isBusiness).toBe(true);
  });

  it('does not match "exact" override with partial text', () => {
    const result = applyOverrides('Staples Store');
    expect(result.category).toBeNull();
  });

  it('returns no override for unmatched merchant', () => {
    const result = applyOverrides('Random Store XYZ');
    expect(result.category).toBeNull();
    expect(result.isBusiness).toBe(false);
  });

  it('matches regex override', () => {
    // Add a regex override to the test db
    testDb.prepare(`
      INSERT INTO category_overrides (merchant_pattern, match_type, custom_category, scope)
      VALUES (?, ?, ?, ?)
    `).run('^Amazon.*', 'regex', 'Shopping', 'personal');

    const result = applyOverrides('Amazon Prime');
    expect(result.category).toBe('Shopping');
    expect(result.isBusiness).toBe(false);
  });

  it('skips invalid regex patterns gracefully', () => {
    testDb.prepare(`
      INSERT INTO category_overrides (merchant_pattern, match_type, custom_category, scope)
      VALUES (?, ?, ?, ?)
    `).run('[invalid(regex', 'regex', 'Bad', 'personal');

    // Should not throw, just skip the invalid regex
    const result = applyOverrides('test');
    expect(result.category).toBeNull();
  });
});
